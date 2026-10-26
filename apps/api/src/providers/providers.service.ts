import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_CONFIG, ValidatedEnvironment } from '../common/config/env.validation';
import { estimateTokens as estimateTokensUtil } from '../common/utils/token-estimator';
import { ModelCatalogService } from './model-catalog.service';

export interface ModelMetadata {
  id: string;
  name: string;
  provider: string;
  description?: string;
}

export interface CompletionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  source: 'provider-reported' | 'estimated';
}

export interface CompletionResult {
  success: boolean;
  model: string;
  content?: string;
  latencyMs: number;
  usage?: CompletionUsage;
  cost?: number | null;
  costSource?: 'provider-reported' | 'catalog-estimate';
  errorType?:
    | 'provider_auth_error'
    | 'provider_quota_error'
    | 'provider_rate_limited'
    | 'gateway_unreachable'
    | 'model_error'
    | 'timeout'
    | 'invalid_request'
    | 'provider_error';
  errorMessage?: string;
  configurationHint?: string;
  upstreamStatus?: number;
}

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly appConfig: ValidatedEnvironment,
    private readonly configService: ConfigService,
    private readonly modelCatalog: ModelCatalogService,
  ) {}

  getGatewayUrl(): string {
    return this.appConfig.LITELLM_GATEWAY_URL;
  }

  getMasterKey(): string {
    return this.appConfig.LITELLM_MASTER_KEY;
  }

  /**
   * Returns models configured in LiteLLM Proxy.
   * Handles empty model lists or gateway connection failures gracefully.
   */
  async listModels(): Promise<{ models: ModelMetadata[]; gatewayConnected: boolean; error?: string }> {
    const gatewayUrl = this.getGatewayUrl();
    const masterKey = this.getMasterKey();

    try {
      const response = await fetch(`${gatewayUrl}/v1/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${masterKey}`,
        },
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        throw new Error(`Gateway returned HTTP ${response.status}`);
      }

      const body = (await response.json()) as { data?: Array<{ id: string; owned_by?: string }> };
      const data = body.data || [];
      const catalog = await this.modelCatalog.getCatalog();

      const models: ModelMetadata[] = data.map((m) => {
        const entry = catalog.get(m.id.toLowerCase());
        const provider = (entry && entry.provider !== 'unknown') ? entry.provider : (m.owned_by || 'gateway');
        return {
          id: m.id,
          name: m.id,
          provider,
        };
      });

      return {
        models,
        gatewayConnected: true,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(`Failed to fetch models from LiteLLM gateway: ${msg}`);
      return {
        models: [],
        gatewayConnected: false,
        error: `LiteLLM gateway unreachable at ${gatewayUrl}: ${msg}`,
      };
    }
  }

  /**
   * Executes a chat completion via the LiteLLM Proxy OpenAI-compatible endpoint.
   * Captures latency, token counts, and distinguishes provider errors clearly.
   */
  async executeChatCompletion(params: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    traceId?: string;
    spanId?: string;
    requestId?: string;
  }): Promise<CompletionResult> {
    const startTime = Date.now();
    const gatewayUrl = this.getGatewayUrl();
    const masterKey = this.getMasterKey();
    const timeoutMs = params.timeoutMs ?? this.appConfig.LLM_REQUEST_TIMEOUT_MS;

    const requestBody = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1024,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${masterKey}`,
    };

    if (params.traceId && params.spanId) {
      headers['traceparent'] = `00-${params.traceId}-${params.spanId}-01`;
      headers['x-litellm-trace-id'] = params.traceId;
    }
    if (params.requestId) {
      headers['x-request-id'] = params.requestId;
    }

    try {
      const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        const modelEntry = await this.modelCatalog.getModel(params.model);
        return this.parseGatewayError(response.status, errorText, params.model, latencyMs, modelEntry.provider);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        model?: string;
      };

      const content = data.choices?.[0]?.message?.content || '';
      const promptTokens = data.usage?.prompt_tokens ?? this.estimateTokens(JSON.stringify(params.messages));
      const completionTokens = data.usage?.completion_tokens ?? this.estimateTokens(content);
      const totalTokens = data.usage?.total_tokens ?? (promptTokens + completionTokens);

      const costHeader = response.headers.get('x-litellm-response-cost');
      let cost: number | null = null;
      let costSource: 'provider-reported' | 'catalog-estimate' = 'catalog-estimate';

      if (costHeader !== null && costHeader.trim() !== '') {
        const parsedCost = parseFloat(costHeader);
        if (!isNaN(parsedCost)) {
          cost = parsedCost;
          costSource = 'provider-reported';
        }
      }

      if (cost === null) {
        const calculated = await this.modelCatalog.calculateCost(params.model, promptTokens, completionTokens);
        cost = calculated.cost;
        costSource = 'catalog-estimate';
      }

      return {
        success: true,
        model: data.model || params.model,
        content,
        latencyMs,
        cost,
        costSource,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          source: data.usage?.total_tokens !== undefined ? 'provider-reported' : 'estimated',
        },
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      const msg = err instanceof Error ? err.message : 'Unknown error';

      if (isTimeout) {
        return {
          success: false,
          model: params.model,
          latencyMs,
          errorType: 'timeout',
          errorMessage: `Request timed out after ${timeoutMs}ms while awaiting response from gateway.`,
        };
      }

      return {
        success: false,
        model: params.model,
        latencyMs,
        errorType: 'gateway_unreachable',
        errorMessage: `Unable to reach LiteLLM Gateway at ${gatewayUrl}: ${msg}`,
        configurationHint: 'Verify that the LiteLLM gateway service is started (`npm run start:gateway` or Docker).',
      };
    }
  }

  /**
   * Parses gateway error responses structurally into clean messages without leaking secret keys (ERRCLS-01).
   * 1. Classifies by HTTP status first (401/403 -> auth, 429 -> quota, 408/504 -> timeout, 400/422 -> invalid request, 5xx -> provider error).
   * 2. Then checks structured LiteLLM error.type / error.code for non-standard responses.
   * 3. Substring matching on message text is completely eliminated.
   */
  parseGatewayError(
    status: number,
    rawBody: string,
    model: string,
    latencyMs: number,
    providerName?: string,
  ): CompletionResult {
    let errorDetail = rawBody;
    let errorCode: string | undefined;
    let errorType: string | undefined;

    try {
      const parsed = JSON.parse(rawBody);
      if (parsed?.error) {
        if (typeof parsed.error.message === 'string') {
          errorDetail = parsed.error.message;
        }
        if (typeof parsed.error.code === 'string') {
          errorCode = parsed.error.code;
        }
        if (typeof parsed.error.type === 'string') {
          errorType = parsed.error.type;
        }
      }
    } catch {
      // Use raw text
    }

    const providerLabel =
      providerName && providerName !== 'unknown' && providerName !== 'gateway'
        ? providerName === 'openai'
          ? 'OpenAI (OPENAI_API_KEY)'
          : providerName === 'anthropic'
            ? 'Anthropic (ANTHROPIC_API_KEY)'
            : providerName
        : 'configured LLM provider';

    // 1. Classification by HTTP status first
    if (status === 401 || status === 403) {
      return {
        success: false,
        model,
        latencyMs,
        upstreamStatus: status,
        errorType: 'provider_auth_error',
        errorMessage: `Upstream provider authentication failed for model "${model}".`,
        configurationHint: `Configure valid credentials for ${providerLabel} in your environment or .env file before running live calls with this model.`,
      };
    }

    if (status === 408 || status === 504) {
      return {
        success: false,
        model,
        latencyMs,
        upstreamStatus: status,
        errorType: 'timeout',
        errorMessage: `Gateway timed out (HTTP ${status}): ${errorDetail}`,
      };
    }

    if (status === 429) {
      const isQuota = errorCode === 'insufficient_quota' || errorType === 'insufficient_quota';
      if (isQuota) {
        return {
          success: false,
          model,
          latencyMs,
          upstreamStatus: status,
          errorType: 'provider_quota_error',
          errorMessage: `Upstream provider quota exceeded for model "${model}".`,
          configurationHint: `Your upstream account has run out of credits or exceeded its maximum spending quota. Please check billing or usage limits for ${providerLabel}.`,
        };
      }

      return {
        success: false,
        model,
        latencyMs,
        upstreamStatus: status,
        errorType: 'provider_rate_limited',
        errorMessage: `Upstream provider rate limit exceeded for "${model}".`,
        configurationHint: 'Rate limit exceeded. Please wait a few moments before retrying your request.',
      };
    }

    if (status === 400 || status === 422) {
      return {
        success: false,
        model,
        latencyMs,
        upstreamStatus: status,
        errorType: 'invalid_request',
        errorMessage: `Invalid request for model "${model}" (HTTP ${status}): ${errorDetail}`,
        configurationHint: 'Check model parameters, prompt formatting, or max_tokens in your request.',
      };
    }

    if (status >= 500 && status < 600) {
      return {
        success: false,
        model,
        latencyMs,
        upstreamStatus: status,
        errorType: 'provider_error',
        errorMessage: `Upstream provider error (HTTP ${status}): ${errorDetail}`,
        configurationHint: 'Upstream model provider encountered an internal error. Check provider status page or retry later.',
      };
    }

    // 2. Structured fallback for non-standard statuses (e.g. proxy wrappers)
    if (
      errorCode === 'insufficient_quota' ||
      errorCode === 'rate_limit_exceeded' ||
      errorType === 'insufficient_quota' ||
      errorType === 'rate_limit_error'
    ) {
      return {
        success: false,
        model,
        latencyMs,
        upstreamStatus: status,
        errorType: 'provider_quota_error',
        errorMessage: `Upstream provider rate limit or quota exceeded for "${model}".`,
        configurationHint: 'Check your upstream provider quota or wait a few moments before retrying.',
      };
    }

    if (
      errorCode === 'invalid_api_key' ||
      errorCode === 'authentication_error' ||
      errorType === 'authentication_error'
    ) {
      return {
        success: false,
        model,
        latencyMs,
        upstreamStatus: status,
        errorType: 'provider_auth_error',
        errorMessage: `Upstream provider authentication failed for model "${model}".`,
        configurationHint: `Configure valid credentials for ${providerLabel} in your environment or .env file before running live calls with this model.`,
      };
    }

    return {
      success: false,
      model,
      latencyMs,
      upstreamStatus: status,
      errorType: 'provider_error',
      errorMessage: `Gateway error (HTTP ${status}): ${errorDetail}`,
      configurationHint: 'Check model configuration in infra/litellm/config.yaml or server logs.',
    };
  }

  /**
   * Fallback character-based token estimation (~4 characters per token).
   */
  estimateTokens(text: string): number {
    return estimateTokensUtil(text);
  }
}
