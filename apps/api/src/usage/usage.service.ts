import {
  Injectable,
  Inject,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { UsageRecord } from '@prisma/client';
import { calculateCost } from '../experiments/cost-calculator';
import { APP_CONFIG, ValidatedEnvironment } from '../common/config/env.validation';
import {
  UpdateQuotaPolicyDto,
  ReserveUsageDto,
  ReconcileUsageDto,
} from './dto/usage.dto';
import {
  QuotaPeriodStatus,
  UsageRecordItem,
  ReservationResult,
} from './usage.types';

export const SWEEPER_CUTOFF_MARGIN_MS = 5_000;

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  // In-memory sliding window for rate limiting: userId -> timestamps array
  private readonly rateLimitTracker = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly appConfig: ValidatedEnvironment,
  ) {}

  /**
   * Retrieves or creates the quota policy for a user atomically via upsert.
   */
  async getPolicy(userId: string) {
    const uid = userId;

    try {
      return await this.prisma.quotaPolicy.upsert({
        where: {
          scope_scopeId: {
            scope: 'user',
            scopeId: uid,
          },
        },
        update: {},
        create: {
          scope: 'user',
          scopeId: uid,
          monthlyTokenLimit: 1_000_000,
          requestRateLimit: 60,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const existing = await this.prisma.quotaPolicy.findUnique({
          where: {
            scope_scopeId: {
              scope: 'user',
              scopeId: uid,
            },
          },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  /**
   * USAGE-01: Admin updates quota policy for a target user, validating target user exists.
   */
  async updatePolicyForTargetUser(dto: UpdateQuotaPolicyDto, targetUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!user) {
      throw new NotFoundException(`User with ID "${targetUserId}" not found`);
    }
    return this.updatePolicy(dto, targetUserId);
  }

  /**
   * Updates quota policy (monthly limit and/or rate limit) for demo/dev configuration.
   */
  async updatePolicy(dto: UpdateQuotaPolicyDto, userId: string) {
    const uid = userId;
    const current = await this.getPolicy(uid);

    const updated = await this.prisma.quotaPolicy.update({
      where: { id: current.id },
      data: {
        monthlyTokenLimit:
          dto.monthlyTokenLimit !== undefined
            ? Math.max(1000, dto.monthlyTokenLimit)
            : current.monthlyTokenLimit,
        requestRateLimit:
          dto.requestRateLimit !== undefined
            ? Math.max(1, dto.requestRateLimit)
            : current.requestRateLimit,
      },
    });

    // Also update current active quota period token limit to match new policy
    const currentPeriod = await this.getCurrentPeriodRecord(uid);
    if (currentPeriod && currentPeriod.status === 'active') {
      await this.prisma.quotaPeriod.update({
        where: { id: currentPeriod.id },
        data: {
          tokenLimit: updated.monthlyTokenLimit,
        },
      });
    }

    return updated;
  }

  /**
   * Computes UTC start and end bounds for the current month.
   */
  getUtcMonthBounds(date = new Date()): { periodStart: Date; periodEnd: Date } {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const periodStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const periodEnd = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
    return { periodStart, periodEnd };
  }

  /**
   * Retrieves or creates the active QuotaPeriod for the current month in UTC.
   */
  async getCurrentPeriodRecord(userId: string) {
    const { periodStart, periodEnd } = this.getUtcMonthBounds();
    const policy = await this.getPolicy(userId);

    // Close any older open periods
    await this.prisma.quotaPeriod.updateMany({
      where: {
        userId,
        periodEnd: { lte: new Date() },
        status: 'active',
      },
      data: {
        status: 'closed',
      },
    });

    try {
      return await this.prisma.quotaPeriod.upsert({
        where: {
          userId_periodStart: {
            userId,
            periodStart,
          },
        },
        update: {},
        create: {
          userId,
          periodStart,
          periodEnd,
          tokenLimit: policy.monthlyTokenLimit,
          reservedTokens: 0,
          actualTokens: 0,
          status: 'active',
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const existing = await this.prisma.quotaPeriod.findUnique({
          where: {
            userId_periodStart: {
              userId,
              periodStart,
            },
          },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  /**
   * Checks whether the user has exceeded their request-rate limit (requests per minute).
   */
  checkRateLimit(userId: string, rateLimit: number): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;

    let timestamps = this.rateLimitTracker.get(userId) || [];
    timestamps = timestamps.filter((t) => t > oneMinuteAgo);

    if (timestamps.length >= rateLimit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'RATE_LIMIT_EXCEEDED',
          message: `Request rate limit of ${rateLimit} requests per minute exceeded. Please wait before retrying.`,
          retryAfterSeconds: Math.ceil((timestamps[0] + 60_000 - now) / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    timestamps.push(now);
    this.rateLimitTracker.set(userId, timestamps);
  }

  /**
   * Returns current minute rate limit status for a user.
   */
  getRateLimitStatus(userId: string, rateLimit: number) {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    const timestamps = (this.rateLimitTracker.get(userId) || []).filter((t) => t > oneMinuteAgo);
    return {
      limitPerMinute: rateLimit,
      currentMinuteRequests: timestamps.length,
      remainingRequests: Math.max(0, rateLimit - timestamps.length),
    };
  }

  /**
   * Returns comprehensive status for the active monthly quota period.
   */
  async getStatus(userId: string): Promise<QuotaPeriodStatus> {
    const uid = userId;
    const policy = await this.getPolicy(uid);
    const period = await this.getCurrentPeriodRecord(uid);

    const remainingTokens = Math.max(
      0,
      period.tokenLimit - (period.actualTokens + period.reservedTokens),
    );
    const percentUsed =
      period.tokenLimit > 0
        ? Math.min(100, Math.round((period.actualTokens / period.tokenLimit) * 1000) / 10)
        : 0;
    const percentReserved =
      period.tokenLimit > 0
        ? Math.min(100, Math.round((period.reservedTokens / period.tokenLimit) * 1000) / 10)
        : 0;

    // Calculate sum of estimated cost across reconciled usage records in this period
    const costAggregate = await this.prisma.usageRecord.aggregate({
      where: {
        userId: uid,
        createdAt: {
          gte: period.periodStart,
          lt: period.periodEnd,
        },
        status: 'reconciled',
      },
      _sum: {
        estimatedCost: true,
      },
    });

    const estimatedTotalCost =
      costAggregate._sum.estimatedCost !== null
        ? Math.round(costAggregate._sum.estimatedCost * 1_000_000) / 1_000_000
        : 0;

    return {
      userId: uid,
      periodId: period.id,
      periodStart: (period.periodStart ? new Date(period.periodStart) : new Date()).toISOString(),
      periodEnd: (period.periodEnd ? new Date(period.periodEnd) : new Date()).toISOString(),
      resetDate: (period.periodEnd ? new Date(period.periodEnd) : new Date()).toISOString(),
      tokenLimit: period.tokenLimit,
      actualTokens: period.actualTokens,
      reservedTokens: period.reservedTokens,
      remainingTokens,
      percentUsed,
      percentReserved,
      status: period.status,
      rateLimit: this.getRateLimitStatus(uid, policy.requestRateLimit),
      estimatedTotalCost,
    };
  }

  /**
   * Retrieves a usage record by its unique requestId / idempotency key and scoped userId.
   */
  async getUsageRecord(requestId: string, userId: string): Promise<UsageRecord | null> {
    return this.prisma.usageRecord.findUnique({
      where: {
        userId_requestId: {
          userId,
          requestId,
        },
      },
    });
  }

  /**
   * Concurrency-safe reservation before dispatching a request to the gateway.
   * Atomically claims the usage record first via INSERT ... ON CONFLICT DO NOTHING RETURNING.
   * Only the creator may call the provider.
   */
  async reserveUsage(dto: ReserveUsageDto): Promise<ReservationResult> {
    if (!dto.userId) {
      throw new BadRequestException('userId is required for reserveUsage');
    }
    const uid = dto.userId;
    const policy = await this.getPolicy(uid);

    // 1. Enforce rate limit (independent from monthly token quota)
    this.checkRateLimit(uid, policy.requestRateLimit);

    const estimatedTokens = Math.max(1, dto.estimatedTokens || 1);
    const id = crypto.randomUUID();

    // Ensure the current month quota period exists BEFORE opening the transaction.
    // Out-of-transaction P2002 handling ensures no transaction is aborted.
    const currentPeriod = await this.getCurrentPeriodRecord(uid);

    // 2. Database transaction: Claim first via INSERT ... ON CONFLICT ("userId", "requestId") DO NOTHING RETURNING
    return await this.prisma.$transaction(async (tx) => {
      const insertedRows = await tx.$queryRaw<UsageRecord[]>`
        INSERT INTO "usage_records" (
          "id", "requestId", "userId", "conversationId", "provider", "model",
          "inputTokens", "outputTokens", "tokenUsageSource", "reservedTokens",
          "status", "createdAt"
        ) VALUES (
          ${id}, ${dto.requestId}, ${uid}, ${dto.conversationId || null}, ${dto.provider}, ${dto.model},
          ${0}, ${0}, ${'estimated'}, ${estimatedTokens},
          ${'reserved'}, (NOW() AT TIME ZONE 'UTC')
        )
        ON CONFLICT ("userId", "requestId") DO NOTHING
        RETURNING *;
      `;

      // If no rows returned, record already exists! Only the creator may call provider
      if (!insertedRows || insertedRows.length === 0) {
        const existingRecord = await tx.usageRecord.findUnique({
          where: { userId_requestId: { userId: uid, requestId: dto.requestId } },
        });
        return {
          success: true,
          requestId: dto.requestId,
          reservedTokens: existingRecord?.reservedTokens ?? 0,
          remainingTokens: 0,
          periodId: currentPeriod.id,
          created: false,
          record: existingRecord,
        };
      }

      // 3. Atomic conditional UPDATE on quota_periods in the same transaction as claim INSERT
      const updatedPeriods = await tx.$queryRaw<Array<{
        id: string;
        tokenLimit: number;
        reservedTokens: number;
        actualTokens: number;
        periodEnd: Date;
      }>>`
        UPDATE "quota_periods"
        SET "reservedTokens" = "reservedTokens" + ${estimatedTokens}
        WHERE "id" = ${currentPeriod.id}
          AND ("actualTokens" + "reservedTokens" + ${estimatedTokens}) <= "tokenLimit"
        RETURNING "id", "tokenLimit", "reservedTokens", "actualTokens", "periodEnd";
      `;

      if (!updatedPeriods || updatedPeriods.length === 0) {
        const latestPeriodRows = await tx.$queryRaw<Array<{
          id: string;
          tokenLimit: number;
          reservedTokens: number;
          actualTokens: number;
          periodEnd: Date;
        }>>`
          SELECT "id", "tokenLimit", "reservedTokens", "actualTokens", "periodEnd"
          FROM "quota_periods"
          WHERE "id" = ${currentPeriod.id};
        `;
        const latestPeriod = latestPeriodRows?.[0] || currentPeriod;
        const remaining = Math.max(
          0,
          latestPeriod.tokenLimit - (latestPeriod.actualTokens + latestPeriod.reservedTokens),
        );

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'QUOTA_EXCEEDED',
            message: `Monthly token quota exceeded. Available: ${remaining.toLocaleString()} tokens, Requested reservation: ${estimatedTokens.toLocaleString()} tokens.`,
            tokenLimit: latestPeriod.tokenLimit,
            actualTokens: latestPeriod.actualTokens,
            reservedTokens: latestPeriod.reservedTokens,
            requestedTokens: estimatedTokens,
            remainingTokens: remaining,
            resetDate: latestPeriod.periodEnd ? new Date(latestPeriod.periodEnd).toISOString() : new Date().toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const updatedPeriod = updatedPeriods[0];
      const remainingAfter = Math.max(
        0,
        updatedPeriod.tokenLimit - (updatedPeriod.actualTokens + updatedPeriod.reservedTokens),
      );

      return {
        success: true,
        requestId: dto.requestId,
        reservedTokens: estimatedTokens,
        remainingTokens: remainingAfter,
        periodId: updatedPeriod.id,
        created: true,
        record: insertedRows[0],
      };
    });
  }

  /**
   * Reconciles reservation against provider-reported or estimated completion usage.
   * Idempotent: multiple calls for the same requestId will safely reconcile once.
   */
  async reconcileUsage(dto: ReconcileUsageDto): Promise<{ success: boolean; record: UsageRecord | null }> {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Atomically claim the record for reconciliation: transition status 'reserved' -> 'reconciling'
      const claimResult = await tx.usageRecord.updateMany({
        where: {
          userId: dto.userId,
          requestId: dto.requestId,
          status: 'reserved',
        },
        data: {
          status: 'reconciling',
        },
      });

      if (claimResult.count === 0) {
        // Either not found or already claimed/reconciled/failed
        const existingRecord = await tx.usageRecord.findUnique({
          where: {
            userId_requestId: {
              userId: dto.userId,
              requestId: dto.requestId,
            },
          },
        });

        if (!existingRecord) {
          this.logger.warn(`Cannot reconcile unknown requestId: ${dto.requestId} for user: ${dto.userId}`);
          return { success: false, record: null };
        }

        // Idempotent: already claimed, reconciled, or marked failed
        return { success: true, record: existingRecord };
      }

      // We successfully claimed the record (count === 1). Retrieve it for processing.
      const record = await tx.usageRecord.findUnique({
        where: {
          userId_requestId: {
            userId: dto.userId,
            requestId: dto.requestId,
          },
        },
      });

      if (!record) {
        return { success: false, record: null };
      }

      const reservedAmount = record.reservedTokens;
      const { periodStart } = this.getUtcMonthBounds(record.createdAt);

      const period = await tx.quotaPeriod.findUnique({
        where: {
          userId_periodStart: {
            userId: record.userId,
            periodStart,
          },
        },
      });

      if (dto.success) {
        const inputTokens = dto.usage?.promptTokens ?? 0;
        const outputTokens = dto.usage?.completionTokens ?? 0;
        const totalTokens = dto.usage?.totalTokens ?? (inputTokens + outputTokens);
        const source = dto.usage?.source || 'provider-reported';
        const cost = calculateCost(record.model, inputTokens, outputTokens);

        // Update quota period: release reserved amount and add actual tokens
        if (period) {
          await tx.quotaPeriod.update({
            where: { id: period.id },
            data: {
              reservedTokens: { decrement: reservedAmount },
              actualTokens: { increment: totalTokens },
            },
          });
        } else {
          this.logger.warn(
            `Quota period row missing at reconcile for user: ${record.userId}, periodStart: ${periodStart.toISOString()}`,
          );
        }

        const updatedRecord = await tx.usageRecord.update({
          where: { id: record.id },
          data: {
            inputTokens,
            outputTokens,
            tokenUsageSource: source,
            estimatedCost: cost,
            status: 'reconciled',
            responseBody: dto.responseBody !== undefined ? (dto.responseBody as any) : undefined,
            reconciledAt: new Date(),
          },
        });

        return { success: true, record: updatedRecord };
      } else {
        // Check for ambiguous timeout where upstream provider may have generated tokens
        const isTimeout =
          dto.errorType === 'TIMEOUT' ||
          Boolean(
            dto.error &&
              (dto.error.toLowerCase().includes('timeout') ||
                dto.error.toLowerCase().includes('timed out') ||
                dto.error.toLowerCase().includes('ambiguous')),
          );

        if (isTimeout) {
          // Conservative timeout recovery strategy:
          // Retain estimated input tokens (50% of reservation), release unconsumed remainder,
          // and record as 'timeout-ambiguous' with 'estimated-timeout' source.
          const conservativeConsumed = Math.max(1, Math.floor(reservedAmount * 0.5));

          if (period) {
            await tx.quotaPeriod.update({
              where: { id: period.id },
              data: {
                reservedTokens: { decrement: reservedAmount },
                actualTokens: { increment: conservativeConsumed },
              },
            });
          } else {
            this.logger.warn(
              `Quota period row missing at reconcile for user: ${record.userId}, periodStart: ${periodStart.toISOString()}`,
            );
          }

          const cost = calculateCost(record.model, conservativeConsumed, 0);

          const updatedRecord = await tx.usageRecord.update({
            where: { id: record.id },
            data: {
              inputTokens: conservativeConsumed,
              outputTokens: 0,
              tokenUsageSource: 'estimated-timeout',
              estimatedCost: cost,
              status: 'timeout-ambiguous',
              responseBody: dto.responseBody !== undefined ? (dto.responseBody as any) : { error: dto.error, errorType: dto.errorType },
              reconciledAt: new Date(),
            },
          });

          return { success: true, record: updatedRecord };
        }

        // Definitive pre-dispatch error (e.g. auth failure, unreachable gateway, bad request):
        // 100% of reserved tokens are released with zero actual tokens charged
        if (period) {
          await tx.quotaPeriod.update({
            where: { id: period.id },
            data: {
              reservedTokens: { decrement: reservedAmount },
            },
          });
        } else {
          this.logger.warn(
            `Quota period row missing at reconcile for user: ${record.userId}, periodStart: ${periodStart.toISOString()}`,
          );
        }

        const updatedRecord = await tx.usageRecord.update({
          where: { id: record.id },
          data: {
            status: 'failed',
            responseBody: dto.responseBody !== undefined ? (dto.responseBody as any) : { error: dto.error, errorType: dto.errorType },
            reconciledAt: new Date(),
          },
        });

        return { success: true, record: updatedRecord };
      }
    });
  }

  /**
   * Retrieves usage ledger records ordered newest first.
   */
  async getUsageLedger(userId: string, limit = 50): Promise<UsageRecordItem[]> {
    const uid = userId;

    const records = await this.prisma.usageRecord.findMany({
      where: { userId: uid },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });

    return records.map((r) => ({
      id: r.id,
      requestId: r.requestId,
      userId: r.userId,
      conversationId: r.conversationId,
      provider: r.provider,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.inputTokens + r.outputTokens,
      tokenUsageSource: r.tokenUsageSource,
      reservedTokens: r.reservedTokens,
      estimatedCost: r.estimatedCost,
      status: r.status,
      createdAt: r.createdAt,
      reconciledAt: r.reconciledAt,
    }));
  }

  /**
   * Resets active period usage counters for demo/testing purposes.
   */
  async resetPeriodForDemo(userId: string) {
    const uid = userId;
    const period = await this.getCurrentPeriodRecord(uid);

    await this.prisma.quotaPeriod.update({
      where: { id: period.id },
      data: {
        actualTokens: 0,
        reservedTokens: 0,
      },
    });

    // Reset rate limiter for this user
    this.rateLimitTracker.delete(uid);

    return {
      success: true,
      message: `Active period ${period.id} tokens reset to 0 for demo/testing.`,
      status: await this.getStatus(uid),
    };
  }

  /**
   * Scheduled background sweeper: finds and reclaims leaked reservations older than 2x gateway timeout plus margin.
   * Runs every minute. Safe across multi-instance clusters using row-level FOR UPDATE SKIP LOCKED.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleSweepCron(): Promise<{ sweptCount: number }> {
    const maxAgeMs = this.appConfig.LLM_REQUEST_TIMEOUT_MS * 2 + SWEEPER_CUTOFF_MARGIN_MS;
    return await this.sweepExpiredReservations(maxAgeMs);
  }

  /**
   * Sweeps usage_records with status 'reserved' older than maxAgeMs (defaults to 2x LLM_REQUEST_TIMEOUT_MS + margin),
   * marks them 'expired', and atomically releases reservedTokens back to their quota periods.
   * Row-level FOR UPDATE SKIP LOCKED ensures multi-instance concurrency safety.
   */
  async sweepExpiredReservations(
    maxAgeMs?: number,
    batchSize = 100,
  ): Promise<{ sweptCount: number }> {
    const effectiveMaxAgeMs =
      maxAgeMs ?? this.appConfig.LLM_REQUEST_TIMEOUT_MS * 2 + SWEEPER_CUTOFF_MARGIN_MS;
    const maxAgeSeconds = Math.max(1, Math.round(effectiveMaxAgeMs / 1000));

    return await this.prisma.$transaction(async (tx) => {
      // 1. Concurrency-safe selection using row-level FOR UPDATE SKIP LOCKED
      // TIME-01: compare against UTC timestamp without session timezone distortion
      const staleRecords = await tx.$queryRaw<Array<{
        id: string;
        userId: string;
        requestId: string;
        reservedTokens: number;
        createdAt: Date;
      }>>`
        SELECT "id", "userId", "requestId", "reservedTokens", "createdAt"
        FROM "usage_records"
        WHERE "status" = 'reserved'
          AND "createdAt" <= (NOW() AT TIME ZONE 'UTC') - make_interval(secs => ${maxAgeSeconds})
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED;
      `;

      if (!staleRecords || staleRecords.length === 0) {
        return { sweptCount: 0 };
      }

      for (const record of staleRecords) {
        const { periodStart } = this.getUtcMonthBounds(new Date(record.createdAt));

        // Mark usage record as expired
        await tx.usageRecord.update({
          where: { id: record.id },
          data: {
            status: 'expired',
            reconciledAt: new Date(),
            responseBody: {
              error: 'RESERVATION_EXPIRED',
              message: 'Reservation timed out without reconciliation and was reclaimed by the sweeper.',
            },
          },
        });

        // Atomically release reservedTokens back to active quota period
        if (record.reservedTokens > 0) {
          const period = await tx.quotaPeriod.findUnique({
            where: {
              userId_periodStart: {
                userId: record.userId,
                periodStart,
              },
            },
          });

          if (period) {
            await tx.$queryRaw`
              UPDATE "quota_periods"
              SET "reservedTokens" = GREATEST(0, "reservedTokens" - ${record.reservedTokens})
              WHERE "id" = ${period.id};
            `;
          } else {
            this.logger.warn(
              `Quota period row missing when releasing expired reservation for user: ${record.userId}, periodStart: ${periodStart.toISOString()}`,
            );
          }
        }
      }

      this.logger.log(`Sweeper reclaimed ${staleRecords.length} expired reservation(s) older than ${maxAgeMs}ms`);
      return { sweptCount: staleRecords.length };
    });
  }
}
