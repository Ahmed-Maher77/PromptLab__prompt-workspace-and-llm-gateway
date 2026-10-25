import { Injectable, Logger, ConflictException, HttpException } from '@nestjs/common';
import { ProvidersService, CompletionResult } from '../providers/providers.service';
import { UsageService } from '../usage/usage.service';
import { ObservabilityService, ActiveTraceContext } from '../observability/observability.service';
import { calculateCost } from '../experiments/cost-calculator';
import { StoredLlmResponse } from '../usage/usage.types';

export type LlmOperation =
  | 'playground.execute'
  | 'comparison.slot'
  | 'conversation.turn'
  | 'compaction.preview'
  | 'gateway.request';

export interface ExecuteLlmParams {
  userId: string;
  operation: LlmOperation;
  model: string;
  provider?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  idempotencyKey?: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
  name?: string;
}

export interface LlmExecutionResult extends CompletionResult {
  cost: number | null;
  traceId?: string;
  requestId: string;
}

@Injectable()
export class LlmExecutionService {
  private readonly logger = new Logger(LlmExecutionService.name);

  constructor(
    private readonly usageService: UsageService,
    private readonly observabilityService: ObservabilityService,
    private readonly providersService: ProvidersService,
  ) {}

  /**
   * Centralized execution pipeline for all LLM gateway calls.
   * Executes in strict order:
   * 1. Start distributed trace / spans
   * 2. Reserve estimated quota via claim-first (only creator may call provider)
   * 3. Call the provider inside try / finally
   * 4. In finally: guaranteed usage reconciliation with responseBody, cost calculation,
   *    span closure, and trace completion.
   */
  async execute(params: ExecuteLlmParams): Promise<LlmExecutionResult> {
    const provider = params.provider || 'gateway';
    const requestId =
      params.idempotencyKey ||
      `req-${params.operation.replace('.', '-')}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const traceName = params.name || `${params.operation} (${params.model})`;

    // Calculate prompt input token estimate across all messages
    const inputEstimate = params.messages.reduce((sum, m) => {
      const content = m.content || '';
      const tokens = this.providersService.estimateTokens(content);
      return sum + (tokens || 1);
    }, 0);
    const estimatedTokens = Math.max(1, inputEstimate + (params.maxTokens || 1024));

    // 1. Initialize observability trace
    const trace: ActiveTraceContext | undefined = this.observabilityService.startTrace({
      name: traceName,
      operation: params.operation,
      model: params.model,
      provider,
      userId: params.userId,
      metadata: {
        requestId,
        conversationId: params.conversationId,
        ...(params.metadata || {}),
      },
    });

    let reserved = false;
    let isReplay = false;
    let completionResult: CompletionResult | undefined;
    let executionError: any;
    let llmSpan: any;
    let calculatedCost: number | null = null;

    const reserveSpan = trace?.startSpan('quota.reserve', {
      estimatedTokens,
      requestId,
      userId: params.userId,
    });

    try {
      // 2. Reserve quota before dispatching (claim-first)
      const reservation = await this.usageService.reserveUsage({
        requestId,
        userId: params.userId,
        model: params.model,
        provider,
        estimatedTokens,
        conversationId: params.conversationId,
      });

      // If this call did not create the record, handle replay / in-progress
      if (reservation.created === false) {
        const existingRecord = reservation.record;
        if (!existingRecord || existingRecord.status === 'reserved' || existingRecord.status === 'reconciling') {
          throw new ConflictException('REQUEST_IN_PROGRESS');
        }

        if (existingRecord.status === 'reconciled') {
          if (!existingRecord.responseBody) {
            throw new ConflictException('IDEMPOTENCY_RESULT_UNAVAILABLE');
          }

          isReplay = true;
          const stored = existingRecord.responseBody as unknown as StoredLlmResponse;
          completionResult = {
            success: stored.success,
            content: stored.content,
            model: stored.model,
            latencyMs: stored.latencyMs,
            usage: stored.usage,
            errorMessage: stored.error,
            errorType: stored.errorType as CompletionResult['errorType'],
          };
          calculatedCost = stored.cost ?? null;

          return {
            success: stored.success,
            content: stored.content,
            model: stored.model,
            latencyMs: stored.latencyMs,
            usage: stored.usage,
            cost: stored.cost ?? null,
            traceId: trace?.traceId || stored.traceId,
            requestId,
          };
        }

        // status === 'failed' or 'timeout-ambiguous'
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
      }

      reserved = true;
      reserveSpan?.end('ok');

      // 3. Dispatch to LLM provider
      llmSpan = trace?.startSpan('litellm.chat_completion', { model: params.model });
      completionResult = await this.providersService.executeChatCompletion({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        traceId: trace?.traceId,
        spanId: llmSpan?.id,
        requestId,
      });

      llmSpan?.end(completionResult.success ? 'ok' : 'error', {
        latencyMs: completionResult.latencyMs,
        errorCode: completionResult.errorType,
      });
    } catch (err: any) {
      executionError = err;
      if (!reserved) {
        reserveSpan?.end('error', { error: err?.message || String(err) });
      } else if (llmSpan) {
        llmSpan?.end('error', { error: err?.message || String(err) });
      }
      throw err;
    } finally {
      // 4. Compute cost once
      if (completionResult?.usage) {
        calculatedCost = calculateCost(
          params.model,
          completionResult.usage.promptTokens || 0,
          completionResult.usage.completionTokens || 0,
        );
      }

      // 5. Guaranteed usage reconciliation whenever a quota reservation was established
      if (reserved) {
        const reconcileSpan = trace?.startSpan('quota.reconcile', { requestId });
        try {
          const isSuccess = completionResult ? completionResult.success : false;
          const errorMsg =
            completionResult?.errorMessage ||
            executionError?.message ||
            (executionError ? String(executionError) : undefined);
          const typedError = this.mapErrorType(completionResult?.errorType, executionError);

          const responseBody = isSuccess
            ? {
                success: true,
                model: completionResult?.model || params.model,
                content: completionResult?.content || '',
                latencyMs: completionResult?.latencyMs || 0,
                usage: completionResult?.usage,
                cost: calculatedCost,
                traceId: trace?.traceId,
                requestId,
              }
            : undefined;

          await this.usageService.reconcileUsage({
            requestId,
            userId: params.userId,
            success: isSuccess,
            usage: completionResult?.usage,
            latencyMs: completionResult?.latencyMs,
            error: errorMsg,
            errorType: typedError,
            responseBody,
          });
          reconcileSpan?.end('ok');
        } catch (reconcileErr: any) {
          reconcileSpan?.end('error', { error: reconcileErr?.message || String(reconcileErr) });
          this.logger.error(
            `Failed to reconcile usage for ${requestId}: ${reconcileErr?.message || reconcileErr}`,
            reconcileErr?.stack,
          );
        }
      }

      let traceStatus: 'success' | 'error' | 'rate_limited' = 'error';
      let errorCode = completionResult?.errorType || (executionError ? 'EXECUTION_EXCEPTION' : undefined);

      if (isReplay) {
        traceStatus = 'success';
        errorCode = undefined;
      } else if (completionResult?.success) {
        traceStatus = 'success';
      } else if (
        !reserved &&
        executionError instanceof HttpException &&
        executionError.getStatus() === 429
      ) {
        traceStatus = 'rate_limited';
        errorCode = 'RATE_LIMIT_EXCEEDED';
      }

      trace?.complete({
        status: traceStatus,
        usage: completionResult?.usage,
        cost: calculatedCost,
        errorCode,
        errorMessage: isReplay
          ? undefined
          : completionResult?.errorMessage ||
            executionError?.message ||
            (executionError ? String(executionError) : undefined),
        metadata: isReplay ? { replayed: true } : undefined,
      });
    }

    const finalResult: LlmExecutionResult = {
      ...completionResult!,
      cost: calculatedCost,
      traceId: trace?.traceId,
      requestId,
    };

    return finalResult;
  }

  private mapErrorType(
    providerErrorType?: string,
    executionError?: any,
  ): 'TIMEOUT' | 'RATE_LIMITED' | 'AUTH_ERROR' | 'INVALID_REQUEST' | 'PROVIDER_ERROR' {
    if (
      providerErrorType === 'timeout' ||
      executionError?.name === 'TimeoutError' ||
      executionError?.message?.toLowerCase().includes('timeout')
    ) {
      return 'TIMEOUT';
    }
    if (providerErrorType === 'provider_quota_error') {
      return 'RATE_LIMITED';
    }
    if (providerErrorType === 'provider_auth_error') {
      return 'AUTH_ERROR';
    }
    return 'PROVIDER_ERROR';
  }
}
