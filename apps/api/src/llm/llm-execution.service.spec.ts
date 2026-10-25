import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus, ConflictException } from '@nestjs/common';
import { LlmExecutionService, ExecuteLlmParams } from './llm-execution.service';
import { ProvidersService } from '../providers/providers.service';
import { UsageService } from '../usage/usage.service';
import { ObservabilityService } from '../observability/observability.service';

describe('LlmExecutionService', () => {
  let service: LlmExecutionService;
  let usageServiceMock: {
    reserveUsage: jest.Mock;
    reconcileUsage: jest.Mock;
    getUsageRecord: jest.Mock;
  };
  let observabilityServiceMock: {
    startTrace: jest.Mock;
  };
  let providersServiceMock: {
    executeChatCompletion: jest.Mock;
    estimateTokens: jest.Mock;
  };

  let mockTrace: {
    traceId: string;
    startSpan: jest.Mock;
    complete: jest.Mock;
  };
  let mockSpan: {
    id: string;
    end: jest.Mock;
  };

  beforeEach(async () => {
    mockSpan = {
      id: 'span-123',
      end: jest.fn(),
    };

    mockTrace = {
      traceId: 'trace-456',
      startSpan: jest.fn().mockReturnValue(mockSpan),
      complete: jest.fn(),
    };

    usageServiceMock = {
      reserveUsage: jest.fn().mockResolvedValue({ success: true }),
      reconcileUsage: jest.fn().mockResolvedValue({ success: true }),
      getUsageRecord: jest.fn().mockResolvedValue(null),
    };

    observabilityServiceMock = {
      startTrace: jest.fn().mockReturnValue(mockTrace),
    };

    providersServiceMock = {
      estimateTokens: jest.fn().mockReturnValue(50),
      executeChatCompletion: jest.fn().mockResolvedValue({
        success: true,
        model: 'gpt-4o-mini',
        content: 'Hello, world!',
        latencyMs: 120,
        usage: {
          promptTokens: 40,
          completionTokens: 20,
          totalTokens: 60,
          source: 'provider-reported',
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmExecutionService,
        { provide: UsageService, useValue: usageServiceMock },
        { provide: ObservabilityService, useValue: observabilityServiceMock },
        { provide: ProvidersService, useValue: providersServiceMock },
      ],
    }).compile();

    service = module.get<LlmExecutionService>(LlmExecutionService);
  });

  const baseParams: ExecuteLlmParams = {
    userId: 'user-001',
    operation: 'playground.execute',
    model: 'gpt-4o-mini',
    provider: 'gateway',
    messages: [{ role: 'user', content: 'Say hello' }],
    temperature: 0.7,
    maxTokens: 500,
  };

  it('executes full pipeline: trace -> reserve -> call gateway -> reconcile -> trace complete on success', async () => {
    const result = await service.execute(baseParams);

    expect(result.success).toBe(true);
    expect(result.content).toBe('Hello, world!');
    expect(result.traceId).toBe('trace-456');
    expect(typeof result.cost).toBe('number');

    expect(observabilityServiceMock.startTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'playground.execute',
        model: 'gpt-4o-mini',
        userId: 'user-001',
      }),
    );
    expect(usageServiceMock.reserveUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-001',
        model: 'gpt-4o-mini',
        estimatedTokens: 550, // 50 (estimate) + 500 (maxTokens)
      }),
    );
    expect(providersServiceMock.executeChatCompletion).toHaveBeenCalled();
    expect(usageServiceMock.reconcileUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        usage: {
          promptTokens: 40,
          completionTokens: 20,
          totalTokens: 60,
          source: 'provider-reported',
        },
      }),
    );
    expect(mockTrace.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
      }),
    );
  });

  it('guarantees reconcile runs when the gateway call throws an unexpected error', async () => {
    providersServiceMock.executeChatCompletion.mockRejectedValueOnce(
      new Error('Gateway crashed or socket hang up'),
    );

    await expect(service.execute(baseParams)).rejects.toThrow('Gateway crashed or socket hang up');

    // Quota was reserved before the call
    expect(usageServiceMock.reserveUsage).toHaveBeenCalled();

    // Reconcile MUST have run in finally block
    expect(usageServiceMock.reconcileUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'Gateway crashed or socket hang up',
        errorType: 'PROVIDER_ERROR',
      }),
    );

    // Spans and trace must have been ended
    expect(mockSpan.end).toHaveBeenCalledWith('error', expect.any(Object));
    expect(mockTrace.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        errorCode: 'EXECUTION_EXCEPTION',
      }),
    );
  });

  it('passes typed TIMEOUT errorType to reconcile when provider reports timeout', async () => {
    providersServiceMock.executeChatCompletion.mockResolvedValueOnce({
      success: false,
      model: 'gpt-4o-mini',
      latencyMs: 15000,
      errorType: 'timeout',
      errorMessage: 'Gateway timed out waiting for upstream LLM',
    });

    const result = await service.execute(baseParams);

    expect(result.success).toBe(false);
    expect(usageServiceMock.reconcileUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorType: 'TIMEOUT',
        error: 'Gateway timed out waiting for upstream LLM',
      }),
    );
    expect(mockTrace.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        errorCode: 'timeout',
      }),
    );
  });

  it('handles quota reservation failure (429) without attempting reconcile and marks trace rate_limited', async () => {
    usageServiceMock.reserveUsage.mockRejectedValueOnce(
      new HttpException('Monthly token quota exceeded', HttpStatus.TOO_MANY_REQUESTS),
    );

    await expect(service.execute(baseParams)).rejects.toThrow(HttpException);

    // Gateway was NOT called
    expect(providersServiceMock.executeChatCompletion).not.toHaveBeenCalled();

    // Reconcile was NOT called (no reservation was established)
    expect(usageServiceMock.reconcileUsage).not.toHaveBeenCalled();

    // Trace was completed with rate_limited
    expect(mockTrace.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rate_limited',
        errorCode: 'RATE_LIMIT_EXCEEDED',
      }),
    );
  });

  it('returns stored result on duplicate idempotencyKey without calling provider or reserving quota', async () => {
    const paramsWithKey: ExecuteLlmParams = {
      ...baseParams,
      idempotencyKey: 'idemp-key-123',
    };

    // First call executes normally
    const firstResult = await service.execute(paramsWithKey);
    expect(firstResult.success).toBe(true);
    expect(providersServiceMock.executeChatCompletion).toHaveBeenCalledTimes(1);
    expect(usageServiceMock.reserveUsage).toHaveBeenCalledTimes(1);

    // Second call with same idempotencyKey must return stored result with 0 additional provider calls
    const secondResult = await service.execute(paramsWithKey);
    expect(secondResult.success).toBe(true);
    expect(secondResult.requestId).toBe('idemp-key-123');
    expect(secondResult.content).toBe(firstResult.content);
    expect(providersServiceMock.executeChatCompletion).toHaveBeenCalledTimes(1); // STILL 1!
    expect(usageServiceMock.reserveUsage).toHaveBeenCalledTimes(1); // STILL 1!
  });

  it('throws 409 ConflictException when idempotencyKey is currently reserved (REQUEST_IN_PROGRESS)', async () => {
    usageServiceMock.getUsageRecord.mockResolvedValueOnce({
      requestId: 'in-flight-key',
      status: 'reserved',
      reservedTokens: 500,
      model: 'gpt-4o-mini',
      userId: 'user-001',
    });

    const params: ExecuteLlmParams = {
      ...baseParams,
      idempotencyKey: 'in-flight-key',
    };

    await expect(service.execute(params)).rejects.toThrow(ConflictException);
    expect(providersServiceMock.executeChatCompletion).not.toHaveBeenCalled();
    expect(usageServiceMock.reserveUsage).not.toHaveBeenCalled();
  });
});

