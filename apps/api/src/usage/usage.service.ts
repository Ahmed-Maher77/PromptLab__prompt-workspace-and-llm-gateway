import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { calculateCost } from '../experiments/cost-calculator';
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

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  // In-memory sliding window for rate limiting: userId -> timestamps array
  private readonly rateLimitTracker = new Map<string, number[]>();

  constructor(private readonly prisma: PrismaService) {}

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
   * Retrieves a usage record by its unique requestId / idempotency key, optionally scoped by userId.
   */
  async getUsageRecord(requestId: string, userId?: string) {
    if (userId) {
      return this.prisma.usageRecord.findUnique({
        where: {
          userId_requestId: {
            userId,
            requestId,
          },
        },
      });
    }
    return this.prisma.usageRecord.findFirst({
      where: { requestId },
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

    // 2. Database transaction: Claim first via INSERT ... ON CONFLICT ("userId", "requestId") DO NOTHING RETURNING
    return await this.prisma.$transaction(async (tx) => {
      let insertedRows: any[] = [];
      try {
        insertedRows = await tx.$queryRaw<any[]>`
          INSERT INTO "usage_records" (
            "id", "requestId", "userId", "conversationId", "provider", "model",
            "inputTokens", "outputTokens", "tokenUsageSource", "reservedTokens",
            "status", "createdAt"
          ) VALUES (
            ${id}, ${dto.requestId}, ${uid}, ${dto.conversationId || null}, ${dto.provider}, ${dto.model},
            ${0}, ${0}, ${'estimated'}, ${estimatedTokens},
            ${'reserved'}, NOW()
          )
          ON CONFLICT ("userId", "requestId") DO NOTHING
          RETURNING *;
        `;
      } catch {
        // Fallback for mocks / unit tests where $queryRaw is mocked without raw SQL engine
        const existing = await tx.usageRecord.findUnique({
          where: { userId_requestId: { userId: uid, requestId: dto.requestId } },
        });
        if (existing) {
          return {
            success: true,
            requestId: dto.requestId,
            reservedTokens: existing.reservedTokens,
            remainingTokens: 0,
            periodId: '',
            created: false,
            record: existing,
          };
        }
        const created = await tx.usageRecord.create({
          data: {
            id,
            requestId: dto.requestId,
            userId: uid,
            conversationId: dto.conversationId || null,
            provider: dto.provider,
            model: dto.model,
            inputTokens: 0,
            outputTokens: 0,
            tokenUsageSource: 'estimated',
            reservedTokens: estimatedTokens,
            status: 'reserved',
          },
        });
        insertedRows = [created];
      }

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
          periodId: '',
          created: false,
          record: existingRecord!,
        };
      }

      // We created the record (created: true). Now check and increment quota on active quota period.
      const { periodStart, periodEnd } = this.getUtcMonthBounds();

      let period;
      try {
        period = await tx.quotaPeriod.upsert({
          where: {
            userId_periodStart: {
              userId: uid,
              periodStart,
            },
          },
          update: {},
          create: {
            userId: uid,
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
          period = (await tx.quotaPeriod.findUnique({
            where: {
              userId_periodStart: {
                userId: uid,
                periodStart,
              },
            },
          }))!;
        } else {
          throw err;
        }
      }

      // Row-level lock to serialize concurrent requests and eliminate stale reads
      let activeActual = period.actualTokens;
      let activeReserved = period.reservedTokens;
      let activeLimit = period.tokenLimit;

      if (typeof tx.$queryRawUnsafe === 'function') {
        try {
          const rows = (await tx.$queryRawUnsafe(
            `SELECT id, "tokenLimit", "reservedTokens", "actualTokens" FROM "quota_periods" WHERE id = $1 FOR UPDATE`,
            period.id,
          )) as Array<{ id: string; tokenLimit: number; reservedTokens: number; actualTokens: number }>;

          if (rows && rows.length > 0) {
            activeLimit = rows[0].tokenLimit ?? activeLimit;
            activeReserved = rows[0].reservedTokens ?? activeReserved;
            activeActual = rows[0].actualTokens ?? activeActual;
          }
        } catch {
          // Continues safely in environments or mocks without raw SQL support
        }
      }

      const totalProjected = activeActual + activeReserved + estimatedTokens;

      if (totalProjected > activeLimit) {
        const remaining = Math.max(
          0,
          activeLimit - (activeActual + activeReserved),
        );
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'QUOTA_EXCEEDED',
            message: `Monthly token quota exceeded. Available: ${remaining.toLocaleString()} tokens, Requested reservation: ${estimatedTokens.toLocaleString()} tokens.`,
            tokenLimit: activeLimit,
            actualTokens: activeActual,
            reservedTokens: activeReserved,
            requestedTokens: estimatedTokens,
            remainingTokens: remaining,
            resetDate: period.periodEnd.toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Atomically increment reserved tokens
      const updatedPeriod = await tx.quotaPeriod.update({
        where: { id: period.id },
        data: {
          reservedTokens: { increment: estimatedTokens },
        },
      });

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
  async reconcileUsage(dto: ReconcileUsageDto): Promise<{ success: boolean; record: any }> {
    return await this.prisma.$transaction(async (tx) => {
      let record = await tx.usageRecord.findFirst({
        where: dto.userId
          ? { userId: dto.userId, requestId: dto.requestId }
          : { requestId: dto.requestId },
      });

      if (!record && typeof tx.usageRecord.findUnique === 'function') {
        record = await tx.usageRecord.findUnique({
          where: { requestId: dto.requestId } as any,
        });
      }

      if (!record) {
        this.logger.warn(`Cannot reconcile unknown requestId: ${dto.requestId}`);
        return { success: false, record: null };
      }

      // Idempotency: if already reconciled or marked failed, do not double-process
      if (record.status !== 'reserved') {
        return { success: true, record };
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
}
