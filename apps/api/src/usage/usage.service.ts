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
import { ModelCatalogService } from '../providers/model-catalog.service';
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

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly appConfig: ValidatedEnvironment,
    private readonly modelCatalog: ModelCatalogService,
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
   * Admin updates quota policy for a target user, validating target user exists.
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
   * Returns comprehensive status for the active monthly quota period.
   * Strictly read-only: performs zero database writes (no update, updateMany, upsert, or create).
   */
  async getStatus(userId: string): Promise<QuotaPeriodStatus> {
    const uid = userId;
    const { periodStart, periodEnd } = this.getUtcMonthBounds();

    const [policy, period, costAggregate] = await Promise.all([
      this.prisma.quotaPolicy.findUnique({
        where: {
          scope_scopeId: {
            scope: 'user',
            scopeId: uid,
          },
        },
      }),
      this.prisma.quotaPeriod.findUnique({
        where: {
          userId_periodStart: {
            userId: uid,
            periodStart,
          },
        },
      }),
      this.prisma.usageRecord.aggregate({
        where: {
          userId: uid,
          createdAt: {
            gte: periodStart,
            lt: periodEnd,
          },
          status: 'reconciled',
        },
        _sum: {
          estimatedCost: true,
        },
      }),
    ]);

    const effectiveTokenLimit = period?.tokenLimit ?? policy?.monthlyTokenLimit ?? 1_000_000;
    const actualTokens = period?.actualTokens ?? 0;
    const reservedTokens = period?.reservedTokens ?? 0;
    const rateLimit = policy?.requestRateLimit ?? 60;

    const remainingTokens = Math.max(0, effectiveTokenLimit - (actualTokens + reservedTokens));
    const percentUsed =
      effectiveTokenLimit > 0
        ? Math.min(100, Math.round((actualTokens / effectiveTokenLimit) * 1000) / 10)
        : 0;
    const percentReserved =
      effectiveTokenLimit > 0
        ? Math.min(100, Math.round((reservedTokens / effectiveTokenLimit) * 1000) / 10)
        : 0;

    const estimatedTotalCost =
      costAggregate._sum.estimatedCost !== null
        ? Math.round(costAggregate._sum.estimatedCost * 1_000_000) / 1_000_000
        : 0;

    return {
      userId: uid,
      periodId: period?.id ?? 'pending',
      periodStart: (period?.periodStart ? new Date(period.periodStart) : periodStart).toISOString(),
      periodEnd: (period?.periodEnd ? new Date(period.periodEnd) : periodEnd).toISOString(),
      resetDate: (period?.periodEnd ? new Date(period.periodEnd) : periodEnd).toISOString(),
      tokenLimit: effectiveTokenLimit,
      actualTokens,
      reservedTokens,
      remainingTokens,
      percentUsed,
      percentReserved,
      status: period?.status ?? 'active',
      rateLimit: {
        limitPerMinute: rateLimit,
      },
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
        let cost: number | null = dto.cost !== undefined ? dto.cost : null;
        if (cost === null && dto.cost === undefined) {
          const calculated = await this.modelCatalog.calculateCost(record.model, inputTokens, outputTokens);
          cost = calculated.cost;
        }

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
        // Typed timeout detection. Do NOT parse dto.error strings!
        const isTimeout = dto.errorType === 'TIMEOUT';

        if (isTimeout) {
          // Conservative timeout recovery strategy:
          // Charge configured ratio of reservation (QUOTA_TIMEOUT_CHARGE_RATIO, default 50%),
          // release unconsumed remainder, and record as 'timeout-ambiguous' with 'estimated-timeout' source.
          const ratio = this.appConfig.QUOTA_TIMEOUT_CHARGE_RATIO ?? 0.5;
          const conservativeConsumed = Math.floor(reservedAmount * ratio);

          if (period) {
            await tx.quotaPeriod.update({
              where: { id: period.id },
              data: {
                reservedTokens: { decrement: reservedAmount },
                ...(conservativeConsumed > 0 ? { actualTokens: { increment: conservativeConsumed } } : {}),
              },
            });
          } else {
            this.logger.warn(
              `Quota period row missing at reconcile for user: ${record.userId}, periodStart: ${periodStart.toISOString()}`,
            );
          }

          const timeoutCostEst = await this.modelCatalog.calculateCost(record.model, conservativeConsumed, 0);
          const cost = timeoutCostEst.cost;

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

    return {
      success: true,
      message: `Active period ${period.id} tokens reset to 0 for demo/testing.`,
      status: await this.getStatus(uid),
    };
  }

  /**
   * Closes quota periods whose periodEnd has passed and status is still 'active'.
   * Safe across multi-instance clusters.
   */
  async closeExpiredQuotaPeriods(): Promise<{ count: number }> {
    const result = await this.prisma.quotaPeriod.updateMany({
      where: {
        periodEnd: { lte: new Date() },
        status: 'active',
      },
      data: {
        status: 'closed',
      },
    });
    return { count: result.count };
  }

  /**
   * Scheduled background sweeper: closes expired quota periods, then finds and reclaims leaked reservations
   * older than 2x gateway timeout plus margin.
   * Runs every minute. Safe across multi-instance clusters using row-level FOR UPDATE SKIP LOCKED.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleSweepCron(): Promise<{ sweptCount: number; closedPeriodsCount: number }> {
    const closed = await this.closeExpiredQuotaPeriods();
    const maxAgeMs = this.appConfig.LLM_REQUEST_TIMEOUT_MS * 2 + SWEEPER_CUTOFF_MARGIN_MS;
    const sweep = await this.sweepExpiredReservations(maxAgeMs);
    return { sweptCount: sweep.sweptCount, closedPeriodsCount: closed.count };
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
      // Compare against UTC timestamp without session timezone distortion
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
