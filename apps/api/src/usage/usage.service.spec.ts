import { Test, TestingModule } from '@nestjs/testing';
import { UsageService } from './usage.service';
import { PrismaService } from '../prisma/prisma.service';
import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';

describe('UsageService', () => {
  let service: UsageService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'dev-user-001', email: 'developer@promptlab.local' }),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      quotaPolicy: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn().mockImplementation(async (args) => {
          const existing = await mockPrisma.quotaPolicy.findUnique();
          return existing || { id: 'qp-mock', ...args.create };
        }),
      },
      quotaPeriod: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        upsert: jest.fn().mockImplementation(async (args) => {
          const existing = await mockPrisma.quotaPeriod.findUnique();
          return existing || { id: 'period-mock', ...args.create };
        }),
      },
      usageRecord: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { estimatedCost: 0.042 } }),
      },
      $queryRaw: jest.fn().mockImplementation(async () => [
        {
          id: 'rec-1',
          requestId: 'req-1',
          userId: 'dev-user-001',
          reservedTokens: 2_000,
          status: 'reserved',
          createdAt: new Date(),
        },
      ]),
      $transaction: jest.fn().mockImplementation(async (callback) => {
        return callback(mockPrisma);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsageService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsageService>(UsageService);
  });

  describe('getPolicy & updatePolicy', () => {
    it('should create default policy with 1,000,000 monthly tokens and 60 req/min if none exists', async () => {
      mockPrisma.quotaPolicy.findUnique.mockResolvedValueOnce(null);
      mockPrisma.quotaPolicy.create.mockResolvedValueOnce({
        id: 'qp-1',
        scope: 'user',
        scopeId: 'dev-user-001',
        monthlyTokenLimit: 1_000_000,
        requestRateLimit: 60,
      });

      const policy = await service.getPolicy('dev-user-001');

      expect(policy.monthlyTokenLimit).toBe(1_000_000);
      expect(policy.requestRateLimit).toBe(60);
      expect(mockPrisma.quotaPolicy.upsert).toHaveBeenCalled();
    });

    it('should update quota policy and active quota period limit', async () => {
      mockPrisma.quotaPolicy.findUnique.mockResolvedValueOnce({
        id: 'qp-1',
        scope: 'user',
        scopeId: 'dev-user-001',
        monthlyTokenLimit: 1_000_000,
        requestRateLimit: 60,
      });

      mockPrisma.quotaPolicy.update.mockResolvedValueOnce({
        id: 'qp-1',
        monthlyTokenLimit: 500_000,
        requestRateLimit: 30,
      });

      mockPrisma.quotaPeriod.findUnique.mockResolvedValueOnce({
        id: 'period-1',
        userId: 'dev-user-001',
        tokenLimit: 1_000_000,
        status: 'active',
      });

      const updated = await service.updatePolicy(
        { monthlyTokenLimit: 500_000, requestRateLimit: 30 },
        'dev-user-001',
      );

      expect(updated.monthlyTokenLimit).toBe(500_000);
      expect(mockPrisma.quotaPeriod.update).toHaveBeenCalled();
      const updateCall = mockPrisma.quotaPeriod.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe('period-1');
      expect(updateCall.data.tokenLimit).toBe(500_000);
    });

    it('should throw NotFoundException if target user does not exist (USAGE-01)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updatePolicyForTargetUser(
          { monthlyTokenLimit: 500_000 },
          'non-existent-user',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'non-existent-user' },
      });
    });

    it('should update quota policy for existing target user (USAGE-01)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'target-user-002',
        email: 'user2@promptlab.local',
      });
      mockPrisma.quotaPolicy.findUnique.mockResolvedValueOnce({
        id: 'qp-target',
        scope: 'user',
        scopeId: 'target-user-002',
        monthlyTokenLimit: 1_000_000,
        requestRateLimit: 60,
      });
      mockPrisma.quotaPolicy.update.mockResolvedValueOnce({
        id: 'qp-target',
        monthlyTokenLimit: 750_000,
        requestRateLimit: 60,
      });
      mockPrisma.quotaPeriod.findUnique.mockResolvedValueOnce({
        id: 'period-target',
        userId: 'target-user-002',
        tokenLimit: 1_000_000,
        status: 'active',
      });

      const updated = await service.updatePolicyForTargetUser(
        { monthlyTokenLimit: 750_000 },
        'target-user-002',
      );

      expect(updated.monthlyTokenLimit).toBe(750_000);
      expect(mockPrisma.quotaPolicy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'qp-target' },
          data: expect.objectContaining({ monthlyTokenLimit: 750_000 }),
        }),
      );
    });
  });

  describe('getUtcMonthBounds & getStatus', () => {
    it('should calculate accurate UTC month boundaries', () => {
      const fixedDate = new Date('2026-10-19T14:30:00.000Z');
      const bounds = service.getUtcMonthBounds(fixedDate);

      expect(bounds.periodStart.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(bounds.periodEnd.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    });

    it('should return honest distinct values for used, reserved, remaining, and limit', async () => {
      mockPrisma.quotaPolicy.findUnique.mockResolvedValue({
        id: 'qp-1',
        scope: 'user',
        scopeId: 'dev-user-001',
        monthlyTokenLimit: 100_000,
        requestRateLimit: 60,
      });

      mockPrisma.quotaPeriod.findUnique.mockResolvedValue({
        id: 'period-1',
        userId: 'dev-user-001',
        periodStart: new Date('2026-10-01T00:00:00.000Z'),
        periodEnd: new Date('2026-11-01T00:00:00.000Z'),
        tokenLimit: 100_000,
        actualTokens: 25_000,
        reservedTokens: 5_000,
        status: 'active',
      });

      const status = await service.getStatus('dev-user-001');

      expect(status.tokenLimit).toBe(100_000);
      expect(status.actualTokens).toBe(25_000);
      expect(status.reservedTokens).toBe(5_000);
      expect(status.remainingTokens).toBe(70_000);
      expect(status.percentUsed).toBe(25);
      expect(status.percentReserved).toBe(5);
      expect(status.resetDate).toBe('2026-11-01T00:00:00.000Z');
      expect(status.estimatedTotalCost).toBe(0.042);
    });
  });

  describe('reserveUsage', () => {
    it('should reserve estimated tokens and return remaining tokens within quota', async () => {
      mockPrisma.quotaPolicy.findUnique.mockResolvedValue({
        id: 'qp-1',
        monthlyTokenLimit: 100_000,
        requestRateLimit: 60,
      });

      mockPrisma.usageRecord.findUnique.mockResolvedValueOnce(null);

      mockPrisma.quotaPeriod.findUnique.mockResolvedValue({
        id: 'period-1',
        userId: 'dev-user-001',
        periodStart: new Date('2026-10-01T00:00:00.000Z'),
        periodEnd: new Date('2026-11-01T00:00:00.000Z'),
        tokenLimit: 100_000,
        actualTokens: 10_000,
        reservedTokens: 0,
      });

      mockPrisma.quotaPeriod.update.mockResolvedValueOnce({
        id: 'period-1',
        tokenLimit: 100_000,
        actualTokens: 10_000,
        reservedTokens: 2_000,
      });

      const res = await service.reserveUsage({
        requestId: 'req-1',
        userId: 'dev-user-001',
        model: 'gpt-4o-mini',
        provider: 'openai',
        estimatedTokens: 2_000,
      });

      expect(res.success).toBe(true);
      expect(res.reservedTokens).toBe(2_000);
      expect(res.remainingTokens).toBe(88_000);

      const periodUpdate = mockPrisma.quotaPeriod.update.mock.calls[0][0];
      expect(periodUpdate.data.reservedTokens).toEqual({ increment: 2_000 });
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });

    it('should reject reservation with 429 QUOTA_EXCEEDED when quota is exhausted', async () => {
      mockPrisma.quotaPolicy.findUnique.mockResolvedValue({
        id: 'qp-1',
        monthlyTokenLimit: 50_000,
        requestRateLimit: 60,
      });

      mockPrisma.usageRecord.findUnique.mockResolvedValueOnce(null);

      mockPrisma.quotaPeriod.findUnique.mockResolvedValue({
        id: 'period-1',
        userId: 'dev-user-001',
        periodStart: new Date('2026-10-01T00:00:00.000Z'),
        periodEnd: new Date('2026-11-01T00:00:00.000Z'),
        tokenLimit: 50_000,
        actualTokens: 48_000,
        reservedTokens: 1_000,
      });

      let thrownError: any = null;
      try {
        await service.reserveUsage({
          requestId: 'req-overflow',
          userId: 'dev-user-001',
          model: 'gpt-4o-mini',
          provider: 'openai',
          estimatedTokens: 2_000,
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError instanceof HttpException).toBe(true);
      expect(thrownError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const resp = thrownError.getResponse();
      expect(resp.error).toBe('QUOTA_EXCEEDED');
      expect(resp.tokenLimit).toBe(50_000);
      expect(resp.actualTokens).toBe(48_000);
      expect(resp.reservedTokens).toBe(1_000);
      expect(resp.remainingTokens).toBe(1_000);
    });

    it('should be idempotent for duplicate reservation requests with the same requestId', async () => {
      mockPrisma.quotaPolicy.findUnique.mockResolvedValue({
        id: 'qp-1',
        monthlyTokenLimit: 100_000,
        requestRateLimit: 60,
      });

      mockPrisma.$queryRaw.mockResolvedValueOnce([]);
      mockPrisma.usageRecord.findUnique.mockResolvedValueOnce({
        requestId: 'req-duplicate',
        userId: 'dev-user-001',
        reservedTokens: 1500,
        status: 'reserved',
      });

      mockPrisma.quotaPeriod.findUnique.mockResolvedValue({
        id: 'period-1',
        tokenLimit: 100_000,
        actualTokens: 20_000,
        reservedTokens: 1500,
      });

      const res = await service.reserveUsage({
        requestId: 'req-duplicate',
        userId: 'dev-user-001',
        model: 'gpt-4o-mini',
        provider: 'openai',
        estimatedTokens: 1500,
      });

      expect(res.success).toBe(true);
      expect(res.created).toBe(false);
      expect(res.requestId).toBe('req-duplicate');
      expect(res.reservedTokens).toBe(1500);
      // Ensure no quota reservation increment for duplicate key
      expect(mockPrisma.quotaPeriod.update).not.toHaveBeenCalled();
    });

    it('should reject second concurrent request when parallel reservations would collectively exceed quota', async () => {
      mockPrisma.quotaPolicy.findUnique.mockResolvedValue({
        id: 'qp-1',
        monthlyTokenLimit: 10_000,
        requestRateLimit: 60,
      });

      mockPrisma.usageRecord.findUnique.mockResolvedValue(null);

      let currentPeriodState = {
        id: 'period-concurrency',
        userId: 'dev-user-001',
        periodStart: new Date('2026-10-01T00:00:00.000Z'),
        periodEnd: new Date('2026-11-01T00:00:00.000Z'),
        tokenLimit: 10_000,
        actualTokens: 4_000,
        reservedTokens: 0,
      };

      mockPrisma.quotaPeriod.findUnique.mockImplementation(async () => ({ ...currentPeriodState }));
      mockPrisma.quotaPeriod.update.mockImplementation(async (args: any) => {
        if (args.data.reservedTokens?.increment) {
          currentPeriodState.reservedTokens += args.data.reservedTokens.increment;
        }
        return { ...currentPeriodState };
      });

      // Request 1: requests 4,000 tokens (4,000 actual + 0 reserved + 4,000 req = 8,000 <= 10,000) -> SUCCEEDS
      const req1 = await service.reserveUsage({
        requestId: 'req-conc-1',
        userId: 'dev-user-001',
        model: 'gpt-4o-mini',
        provider: 'openai',
        estimatedTokens: 4_000,
      });
      expect(req1.success).toBe(true);
      expect(currentPeriodState.reservedTokens).toBe(4_000);

      // Request 2: concurrently attempts 4,000 tokens (4,000 actual + 4,000 reserved + 4,000 req = 12,000 > 10,000) -> REJECTED
      let req2Error: any = null;
      try {
        await service.reserveUsage({
          requestId: 'req-conc-2',
          userId: 'dev-user-001',
          model: 'gpt-4o-mini',
          provider: 'openai',
          estimatedTokens: 4_000,
        });
      } catch (err) {
        req2Error = err;
      }

      expect(req2Error).toBeDefined();
      expect(req2Error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(req2Error.getResponse().error).toBe('QUOTA_EXCEEDED');
      // Verify quota was not breached
      expect(currentPeriodState.actualTokens + currentPeriodState.reservedTokens).toBeLessThanOrEqual(10_000);
    });

    it('should independently enforce request-rate limits (req/min)', async () => {
      mockPrisma.quotaPolicy.findUnique.mockResolvedValue({
        id: 'qp-1',
        monthlyTokenLimit: 1_000_000,
        requestRateLimit: 2, // low rate limit for test
      });

      mockPrisma.usageRecord.findUnique.mockResolvedValue(null);
      mockPrisma.quotaPeriod.findUnique.mockResolvedValue({
        id: 'period-1',
        tokenLimit: 1_000_000,
        actualTokens: 0,
        reservedTokens: 0,
      });
      mockPrisma.quotaPeriod.update.mockResolvedValue({
        tokenLimit: 1_000_000,
        actualTokens: 0,
        reservedTokens: 10,
      });

      // Request 1: ok
      await service.reserveUsage({ requestId: 'r1', userId: 'user-rate', model: 'm', provider: 'p', estimatedTokens: 10 });
      // Request 2: ok
      await service.reserveUsage({ requestId: 'r2', userId: 'user-rate', model: 'm', provider: 'p', estimatedTokens: 10 });

      // Request 3: should fail rate limit even though token quota has plenty of room
      let thrown: any = null;
      try {
        await service.reserveUsage({ requestId: 'r3', userId: 'user-rate', model: 'm', provider: 'p', estimatedTokens: 10 });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeDefined();
      expect(thrown.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(thrown.getResponse().error).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('reconcileUsage', () => {
    it('should reconcile successful response by updating actualTokens, releasing reservation, and computing cost', async () => {
      mockPrisma.usageRecord.findUnique.mockResolvedValueOnce({
        id: 'rec-1',
        requestId: 'req-success',
        userId: 'dev-user-001',
        model: 'gpt-4o-mini',
        provider: 'openai',
        reservedTokens: 1_500,
        status: 'reserved',
        createdAt: new Date(),
      });

      mockPrisma.quotaPeriod.findUnique.mockResolvedValueOnce({
        id: 'period-1',
        userId: 'dev-user-001',
        reservedTokens: 1_500,
        actualTokens: 10_000,
      });

      mockPrisma.usageRecord.update.mockResolvedValueOnce({
        id: 'rec-1',
        status: 'reconciled',
        inputTokens: 800,
        outputTokens: 400,
        tokenUsageSource: 'provider-reported',
      });

      const res = await service.reconcileUsage({
        requestId: 'req-success',
        userId: 'dev-user-001',
        success: true,
        usage: {
          promptTokens: 800,
          completionTokens: 400,
          totalTokens: 1200,
          source: 'provider-reported',
        },
      });

      expect(res.success).toBe(true);

      const periodUpdate = mockPrisma.quotaPeriod.update.mock.calls[0][0];
      expect(periodUpdate.where.id).toBe('period-1');
      expect(periodUpdate.data.reservedTokens).toEqual({ decrement: 1_500 });
      expect(periodUpdate.data.actualTokens).toEqual({ increment: 1200 });

      const recordUpdate = mockPrisma.usageRecord.update.mock.calls[0][0];
      expect(recordUpdate.data.status).toBe('reconciled');
      expect(recordUpdate.data.inputTokens).toBe(800);
      expect(recordUpdate.data.outputTokens).toBe(400);
      expect(recordUpdate.data.tokenUsageSource).toBe('provider-reported');
    });

    it('should safely release reservation on failed or timed-out requests without charging actualTokens', async () => {
      mockPrisma.usageRecord.findUnique.mockResolvedValueOnce({
        id: 'rec-failed',
        requestId: 'req-fail',
        userId: 'dev-user-001',
        model: 'gpt-4o-mini',
        reservedTokens: 2_000,
        status: 'reserved',
        createdAt: new Date(),
      });

      mockPrisma.quotaPeriod.findUnique.mockResolvedValueOnce({
        id: 'period-1',
        userId: 'dev-user-001',
        reservedTokens: 2_000,
        actualTokens: 10_000,
      });

      const res = await service.reconcileUsage({
        requestId: 'req-fail',
        userId: 'dev-user-001',
        success: false,
        error: 'Missing API key: provider authentication error',
      });

      expect(res.success).toBe(true);

      const periodUpdate = mockPrisma.quotaPeriod.update.mock.calls[0][0];
      expect(periodUpdate.where.id).toBe('period-1');
      expect(periodUpdate.data.reservedTokens).toEqual({ decrement: 2_000 }); // 100% reservation released atomically!
      expect(periodUpdate.data.actualTokens).toBeUndefined(); // Zero tokens deducted!

      const recordUpdate = mockPrisma.usageRecord.update.mock.calls[0][0];
      expect(recordUpdate.data.status).toBe('failed');
    });

    it('should conservatively retain partial tokens on ambiguous timeout instead of assuming zero usage', async () => {
      mockPrisma.usageRecord.findUnique.mockResolvedValueOnce({
        id: 'rec-timeout',
        requestId: 'req-timeout-1',
        userId: 'dev-user-001',
        model: 'gpt-4o-mini',
        reservedTokens: 2_000,
        status: 'reserved',
        createdAt: new Date(),
      });

      mockPrisma.quotaPeriod.findUnique.mockResolvedValueOnce({
        id: 'period-1',
        userId: 'dev-user-001',
        reservedTokens: 2_000,
        actualTokens: 10_000,
      });

      const res = await service.reconcileUsage({
        requestId: 'req-timeout-1',
        userId: 'dev-user-001',
        success: false,
        error: 'Request timed out after 30000ms while awaiting response from gateway.',
      });

      expect(res.success).toBe(true);

      const periodUpdate = mockPrisma.quotaPeriod.update.mock.calls[0][0];
      expect(periodUpdate.where.id).toBe('period-1');
      expect(periodUpdate.data.reservedTokens).toEqual({ decrement: 2_000 });
      // Conservative deduction: retains 50% of reservation (1,000 tokens)
      expect(periodUpdate.data.actualTokens).toEqual({ increment: 1_000 });

      const recordUpdate = mockPrisma.usageRecord.update.mock.calls[0][0];
      expect(recordUpdate.data.status).toBe('timeout-ambiguous');
      expect(recordUpdate.data.tokenUsageSource).toBe('estimated-timeout');
      expect(recordUpdate.data.inputTokens).toBe(1_000);
      expect(recordUpdate.data.estimatedCost).toBeGreaterThan(0);
    });

    it('should be idempotent and not double-reconcile already completed records', async () => {
      mockPrisma.usageRecord.findUnique.mockResolvedValueOnce({
        id: 'rec-already',
        requestId: 'req-already',
        userId: 'dev-user-001',
        status: 'reconciled',
      });

      const res = await service.reconcileUsage({
        requestId: 'req-already',
        userId: 'dev-user-001',
        success: true,
      });

      expect(res.success).toBe(true);
      expect(mockPrisma.quotaPeriod.update).not.toHaveBeenCalled();
    });
  });

  describe('resetPeriodForDemo', () => {
    it('should reset active period actualTokens and reservedTokens to 0', async () => {
      mockPrisma.quotaPeriod.findUnique.mockResolvedValue({
        id: 'period-reset',
        userId: 'dev-user-001',
        periodStart: new Date('2026-10-01T00:00:00.000Z'),
        periodEnd: new Date('2026-11-01T00:00:00.000Z'),
        tokenLimit: 1_000_000,
        actualTokens: 50_000,
        reservedTokens: 5_000,
      });
      mockPrisma.quotaPolicy.findUnique.mockResolvedValue({
        monthlyTokenLimit: 1_000_000,
        requestRateLimit: 60,
      });

      const reset = await service.resetPeriodForDemo('dev-user-001');

      expect(reset.success).toBe(true);
      const updateCall = mockPrisma.quotaPeriod.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe('period-reset');
      expect(updateCall.data.actualTokens).toBe(0);
      expect(updateCall.data.reservedTokens).toBe(0);
    });
  });
});
