import { Injectable, Logger, Inject } from '@nestjs/common';
import { APP_CONFIG, ValidatedEnvironment } from '../common/config/env.validation';
import {
  ModelContextPolicy,
  getModelContextPolicy,
  getMaxInputBudget,
} from '../conversations/context-policy';

export interface ModelCatalogEntry {
  modelId: string;
  provider: string;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  inputCostPerToken: number | null;
  outputCostPerToken: number | null;
  isUnknownDefault?: boolean;
}

export const DEFAULT_UNKNOWN_MODEL_ENTRY: ModelCatalogEntry = Object.freeze({
  modelId: 'unknown',
  provider: 'unknown',
  maxInputTokens: 4096,
  maxOutputTokens: 1024,
  inputCostPerToken: null,
  outputCostPerToken: null,
  isUnknownDefault: true,
});

export interface LiteLlmModelInfoResponse {
  data?: Array<{
    model_name?: string;
    id?: string;
    litellm_params?: {
      model?: string;
      [key: string]: unknown;
    };
    model_info?: {
      max_input_tokens?: number;
      max_output_tokens?: number;
      max_tokens?: number;
      input_cost_per_token?: number;
      output_cost_per_token?: number;
      litellm_provider?: string;
      mode?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
}

@Injectable()
export class ModelCatalogService {
  private readonly logger = new Logger(ModelCatalogService.name);
  private cachedCatalog: Map<string, ModelCatalogEntry> | null = null;
  private lastFetchedAt: number = 0;
  private lastFailureAt: number = 0;
  private inFlightFetch: Promise<Map<string, ModelCatalogEntry>> | null = null;
  private readonly ttlMs: number;
  private readonly failureBackoffMs: number;

  constructor(
    @Inject(APP_CONFIG) private readonly appConfig: ValidatedEnvironment,
  ) {
    this.ttlMs = this.appConfig.MODEL_CATALOG_TTL_MS ?? 300000;
    this.failureBackoffMs = this.appConfig.MODEL_CATALOG_FAILURE_BACKOFF_MS ?? 30000;
  }

  getGatewayUrl(): string {
    return this.appConfig.LITELLM_GATEWAY_URL;
  }

  getMasterKey(): string {
    return this.appConfig.LITELLM_MASTER_KEY;
  }

  /**
   * Retrieves the model catalog.
   * If cached and within TTL, returns cache.
   * Concurrent calls during a cache miss share a single in-flight fetch promise.
   * The shared promise applies the fallback itself, so concurrent waiters never see a rejection.
   * If the gateway is unreachable and recent failure backoff is active, avoids hammering the gateway.
   */
  async getCatalog(forceRefresh = false): Promise<Map<string, ModelCatalogEntry>> {
    const now = Date.now();
    if (!forceRefresh && this.cachedCatalog !== null && now - this.lastFetchedAt < this.ttlMs) {
      return this.cachedCatalog;
    }

    if (!forceRefresh && now - this.lastFailureAt < this.failureBackoffMs) {
      return this.cachedCatalog ?? new Map<string, ModelCatalogEntry>();
    }

    if (this.inFlightFetch === null) {
      this.inFlightFetch = this.fetchCatalogFromGateway()
        .then((catalog) => {
          this.cachedCatalog = catalog;
          this.lastFetchedAt = Date.now();
          return catalog;
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `Failed to fetch model catalog from gateway: ${err instanceof Error ? err.message : String(err)}`,
          );
          this.lastFailureAt = Date.now();
          return this.cachedCatalog ?? new Map<string, ModelCatalogEntry>();
        })
        .finally(() => {
          this.inFlightFetch = null;
        });
    }

    return this.inFlightFetch;
  }

  /**
   * Performs the HTTP GET /model/info request to LiteLLM Proxy.
   */
  private async fetchCatalogFromGateway(): Promise<Map<string, ModelCatalogEntry>> {
    const gatewayUrl = this.getGatewayUrl();
    const masterKey = this.getMasterKey();
    const targetUrl = `${gatewayUrl.replace(/\/$/, '')}/model/info`;

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${masterKey}`,
      },
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      throw new Error(`Gateway returned HTTP ${response.status} for /model/info`);
    }

    const body = (await response.json()) as LiteLlmModelInfoResponse;
    const entries = this.parseModelInfoResponse(body);
    const catalog = new Map<string, ModelCatalogEntry>();

    for (const entry of entries) {
      catalog.set(entry.modelId.toLowerCase(), entry);
    }

    return catalog;
  }

  /**
   * Parses raw LiteLLM /model/info JSON into clean ModelCatalogEntry items.
   */
  parseModelInfoResponse(body: LiteLlmModelInfoResponse): ModelCatalogEntry[] {
    const data = body?.data || [];
    const entries: ModelCatalogEntry[] = [];

    for (const item of data) {
      const modelId = item.model_name || item.id;
      if (!modelId) continue;

      const info = item.model_info;
      const params = item.litellm_params;

      const provider =
        info?.litellm_provider ||
        (typeof params?.model === 'string' ? params.model.split('/')[0] : 'gateway');

      const maxInputTokens =
        typeof info?.max_input_tokens === 'number'
          ? info.max_input_tokens
          : typeof info?.max_tokens === 'number'
            ? info.max_tokens
            : null;

      const maxOutputTokens =
        typeof info?.max_output_tokens === 'number' ? info.max_output_tokens : null;

      const inputCostPerToken =
        typeof info?.input_cost_per_token === 'number' ? info.input_cost_per_token : null;

      const outputCostPerToken =
        typeof info?.output_cost_per_token === 'number' ? info.output_cost_per_token : null;

      entries.push({
        modelId,
        provider,
        maxInputTokens,
        maxOutputTokens,
        inputCostPerToken,
        outputCostPerToken,
      });
    }

    return entries;
  }

  /**
   * Returns metadata for a model ID from catalog, falling back to DEFAULT_UNKNOWN_MODEL_ENTRY.
   */
  async getModel(modelId: string): Promise<ModelCatalogEntry> {
    const catalog = await this.getCatalog();
    const normalized = (modelId || '').toLowerCase().trim();
    const entry = catalog.get(normalized);

    if (entry) {
      return entry;
    }

    // Check if stripped prefix matches (e.g. openai/gpt-4o-mini -> gpt-4o-mini)
    const slashIdx = normalized.lastIndexOf('/');
    if (slashIdx !== -1) {
      const subKey = normalized.substring(slashIdx + 1);
      const subEntry = catalog.get(subKey);
      if (subEntry) return subEntry;
    }

    return {
      ...DEFAULT_UNKNOWN_MODEL_ENTRY,
      modelId,
    };
  }

  /**
   * Derives a ModelContextPolicy from the model's catalog entry.
   */
  async getModelContextPolicy(modelId: string): Promise<ModelContextPolicy> {
    const entry = await this.getModel(modelId);
    return getModelContextPolicy(entry);
  }

  /**
   * Calculates maximum input budget allowed for a model.
   */
  async getMaxInputBudget(modelId: string): Promise<number> {
    const policy = await this.getModelContextPolicy(modelId);
    return getMaxInputBudget(policy);
  }

  /**
   * Calculates cost for token usage from catalog rates.
   * Returns null if pricing is unknown.
   */
  async calculateCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<{ cost: number | null; costSource: 'catalog-estimate' }> {
    const entry = await this.getModel(modelId);

    if (entry.inputCostPerToken !== null && entry.outputCostPerToken !== null) {
      const cost =
        (inputTokens * entry.inputCostPerToken) + (outputTokens * entry.outputCostPerToken);
      const rounded = Math.round(cost * 1_000_000) / 1_000_000;
      return { cost: rounded, costSource: 'catalog-estimate' };
    }

    return { cost: null, costSource: 'catalog-estimate' };
  }

  /**
   * Returns list of unique configured provider names from the catalog.
   */
  async getConfiguredProviders(): Promise<string[]> {
    const catalog = await this.getCatalog();
    const providers = new Set<string>();

    for (const entry of catalog.values()) {
      if (entry.provider && entry.provider !== 'unknown' && entry.provider !== 'gateway') {
        providers.add(entry.provider.toLowerCase());
      }
    }

    return Array.from(providers).sort();
  }

  /**
   * Resets in-memory cache (primarily used in testing).
   */
  clearCache(): void {
    this.cachedCatalog = null;
    this.lastFetchedAt = 0;
    this.lastFailureAt = 0;
    this.inFlightFetch = null;
  }
}
