import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_CONFIG, ValidatedEnvironment } from '../common/config/env.validation';
import { estimateTokens as estimateTokensUtil } from '../common/utils/token-estimator';

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
  errorType?: 'provider_auth_error' | 'provider_quota_error' | 'gateway_unreachable' | 'model_error' | 'timeout';
  errorMessage?: string;
  configurationHint?: string;
}

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly appConfig: ValidatedEnvironment,
    private readonly configService: ConfigService,
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

      const models: ModelMetadata[] = data.map((m) => ({
        id: m.id,
        name: m.id,
        provider: m.owned_by || (m.id.startsWith('gpt') ? 'openai' : m.id.startsWith('claude') ? 'anthropic' : 'gateway'),
      }));

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
        return this.parseGatewayError(response.status, errorText, params.model, latencyMs);
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

      return {
        success: true,
        model: data.model || params.model,
        content,
        latencyMs,
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
   * Parses gateway error responses into clean, informative messages without leaking secret keys.
   */
  private parseGatewayError(
    status: number,
    rawBody: string,
    model: string,
    latencyMs: number,
  ): CompletionResult {
    let errorDetail = rawBody;
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed?.error?.message) {
        errorDetail = parsed.error.message;
      }
    } catch {
      // Use raw text
    }

    const lower = errorDetail.toLowerCase();

    // Check for provider missing/invalid API key
    if (
      status === 401 ||
      lower.includes('api_key') ||
      lower.includes('authentication') ||
      lower.includes('invalid_api_key') ||
      lower.includes('incorrect api key') ||
      lower.includes('no api key provided') ||
      lower.includes('auth error')
    ) {
      const provider = model.startsWith('gpt') ? 'OpenAI (OPENAI_API_KEY)' : model.startsWith('claude') ? 'Anthropic (ANTHROPIC_API_KEY)' : 'configured LLM provider';
      return {
        success: false,
        model,
        latencyMs,
        errorType: 'provider_auth_error',
        errorMessage: `Upstream provider authentication failed for model "${model}".`,
        configurationHint: `Configure valid credentials for ${provider} in your environment or .env file before running live calls with this model.`,
      };
    }

    // Check for provider quota/rate limits
    if (status === 429 || lower.includes('rate limit') || lower.includes('quota')) {
      return {
        success: false,
        model,
        latencyMs,
        errorType: 'provider_quota_error',
        errorMessage: `Upstream provider rate limit or quota exceeded for "${model}".`,
        configurationHint: 'Check your upstream provider quota or wait a few moments before retrying.',
      };
    }

    return {
      success: false,
      model,
      latencyMs,
      errorType: 'model_error',
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
