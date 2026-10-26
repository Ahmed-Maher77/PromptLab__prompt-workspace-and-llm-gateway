import { ExecutionContext, HttpStatus, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserThrottlerGuard, LLM_USER_THROTTLE_KEY } from './user-throttler.guard';

describe('UserThrottlerGuard', () => {
  let guard: UserThrottlerGuard;
  let mockStorage: any;
  let mockReflector: any;
  let mockPrisma: any;

  beforeEach(() => {
    mockStorage = {
      increment: jest.fn().mockResolvedValue({
        totalHits: 1,
        timeToExpire: 60,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    };

    mockReflector = {
      getAllAndOverride: jest.fn(),
    };

    mockPrisma = {
      usageRecord: {
        findFirst: jest.fn(),
      },
      quotaPolicy: {
        findUnique: jest.fn(),
      },
    };

    guard = new UserThrottlerGuard(
      [
        {
          name: 'user',
          ttl: 60_000,
          limit: 60,
        },
      ],
      mockStorage,
      mockReflector,
      mockPrisma,
    );
  });

  const createMockContext = (options: {
    userId?: string;
    idempotencyKey?: string;
    isLlmRoute?: boolean;
  }): ExecutionContext => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === LLM_USER_THROTTLE_KEY) {
        return options.isLlmRoute ?? true;
      }
      return undefined;
    });

    const req: any = {
      headers: {},
      ip: '127.0.0.1',
      user: options.userId ? { id: options.userId, role: 'user' } : undefined,
    };

    if (options.idempotencyKey) {
      req.headers['idempotency-key'] = options.idempotencyKey;
    }

    const res: any = {
      setHeader: jest.fn(),
      header: jest.fn(),
    };

    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  it('bypasses throttling completely if the route is not marked as LLM route', async () => {
    const ctx = createMockContext({ userId: 'user-1', isLlmRoute: false });
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mockStorage.increment).not.toHaveBeenCalled();
  });

  it('increments storage counter keyed by user ID on fresh requests', async () => {
    const ctx = createMockContext({ userId: 'user-abc', isLlmRoute: true });
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mockStorage.increment).toHaveBeenCalledWith(
      expect.stringContaining('user-user:user-abc'),
      60_000,
      60,
      60_000,
      'user',
    );
  });

  it('bypasses counter increment when an idempotent replay is detected', async () => {
    mockPrisma.usageRecord.findFirst.mockResolvedValueOnce({ id: 'rec-reconciled' });

    const ctx = createMockContext({
      userId: 'user-abc',
      idempotencyKey: 'idemp-replay-key-1',
      isLlmRoute: true,
    });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    // Verified: storage increment was NOT called for replayed idempotent request!
    expect(mockStorage.increment).not.toHaveBeenCalled();
  });

  it('uses dynamic limit from QuotaPolicy if set for the user', async () => {
    mockPrisma.quotaPolicy.findUnique.mockResolvedValueOnce({ requestRateLimit: 15 });

    const ctx = createMockContext({ userId: 'user-custom', isLlmRoute: true });
    await guard.canActivate(ctx);

    expect(mockStorage.increment).toHaveBeenCalledWith(
      expect.stringContaining('user-user:user-custom'),
      60_000,
      15, // Dynamic custom limit!
      60_000,
      'user',
    );
  });

  it('throws 429 RATE_LIMIT_EXCEEDED when storage reports isBlocked=true', async () => {
    mockStorage.increment.mockResolvedValueOnce({
      totalHits: 61,
      timeToExpire: 45,
      isBlocked: true,
      timeToBlockExpire: 45,
    });

    const ctx = createMockContext({ userId: 'user-blocked', isLlmRoute: true });

    let thrownError: any = null;
    try {
      await guard.canActivate(ctx);
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(HttpException);
    expect(thrownError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    const resp = thrownError.getResponse();
    expect(resp.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(resp.error).toBe('RATE_LIMIT_EXCEEDED');
    expect(resp.retryAfterSeconds).toBe(45);
  });
});
