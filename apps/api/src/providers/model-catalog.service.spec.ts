import { Test, TestingModule } from '@nestjs/testing';
import {
  ModelCatalogService,
  DEFAULT_UNKNOWN_MODEL_ENTRY,
} from './model-catalog.service';
import { APP_CONFIG } from '../common/config/env.validation';

describe('ModelCatalogService', () => {
  let service: ModelCatalogService;

  const mockAppConfig = {
    LITELLM_GATEWAY_URL: 'http://127.0.0.1:4000',
    LITELLM_MASTER_KEY: 'sk-test-master-key',
    MODEL_CATALOG_TTL_MS: 300000,
  };

  const modelInfoFixture = {
    data: [
      {
        model_name: 'gpt-4o-mini',
        litellm_params: {
          model: 'openai/gpt-4o-mini',
        },
        model_info: {
          max_input_tokens: 128000,
          max_output_tokens: 16384,
          input_cost_per_token: 0.00000015,
          output_cost_per_token: 0.0000006,
          litellm_provider: 'openai',
          mode: 'chat',
        },
      },
      {
        model_name: 'claude-3-5-sonnet',
        litellm_params: {
          model: 'anthropic/claude-3-5-sonnet-20241022',
        },
        model_info: {
          max_input_tokens: 200000,
          max_output_tokens: 8192,
          input_cost_per_token: 0.000003,
          output_cost_per_token: 0.000015,
          litellm_provider: 'anthropic',
          mode: 'chat',
        },
      },
    ],
  };

  beforeEach(async () => {
    mockAppConfig.MODEL_CATALOG_TTL_MS = 300000;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelCatalogService,
        { provide: APP_CONFIG, useValue: mockAppConfig },
      ],
    }).compile();

    service = module.get<ModelCatalogService>(ModelCatalogService);
    service.clearCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('maps entries accurately from recorded /model/info fixture', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce(modelInfoFixture),
    } as unknown as Response);

    const catalog = await service.getCatalog();
    expect(catalog.size).toBe(2);

    const gpt = catalog.get('gpt-4o-mini');
    expect(gpt).toBeDefined();
    expect(gpt?.modelId).toBe('gpt-4o-mini');
    expect(gpt?.provider).toBe('openai');
    expect(gpt?.maxInputTokens).toBe(128000);
    expect(gpt?.maxOutputTokens).toBe(16384);
    expect(gpt?.inputCostPerToken).toBe(0.00000015);
    expect(gpt?.outputCostPerToken).toBe(0.0000006);

    const claude = catalog.get('claude-3-5-sonnet');
    expect(claude).toBeDefined();
    expect(claude?.modelId).toBe('claude-3-5-sonnet');
    expect(claude?.provider).toBe('anthropic');
    expect(claude?.maxInputTokens).toBe(200000);
    expect(claude?.maxOutputTokens).toBe(8192);
    expect(claude?.inputCostPerToken).toBe(0.000003);
    expect(claude?.outputCostPerToken).toBe(0.000015);
  });

  it('caches the catalog in memory and refetches after TTL expiry', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        json: async () => modelInfoFixture,
      } as unknown as Response;
    });

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    // Call 1: cold cache -> fetch 1
    await service.getCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Call 2: within TTL (now + 1000) -> uses cached catalog, no extra fetch
    jest.spyOn(Date, 'now').mockReturnValue(now + 1000);
    await service.getCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Call 3: after TTL (now + 300001) -> cache expired, triggers fetch 2
    jest.spyOn(Date, 'now').mockReturnValue(now + 300001);
    await service.getCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight fetch across concurrent cache misses (single-flight / no thundering herd)', async () => {
    let resolveResponse: (value: any) => void;
    const delayedPromise = new Promise((resolve) => {
      resolveResponse = resolve;
    });

    const fetchMock = jest.spyOn(global, 'fetch').mockImplementationOnce(async () => {
      return delayedPromise as any;
    });

    // Launch 5 concurrent calls on cold cache
    const call1 = service.getCatalog();
    const call2 = service.getCatalog();
    const call3 = service.getCatalog();
    const call4 = service.getCatalog();
    const call5 = service.getCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Resolve the delayed response
    resolveResponse!({
      ok: true,
      json: async () => modelInfoFixture,
    });

    const [r1, r2, r3, r4, r5] = await Promise.all([call1, call2, call3, call4, call5]);
    expect(r1.size).toBe(2);
    expect(r2).toBe(r1);
    expect(r3).toBe(r1);
    expect(r4).toBe(r1);
    expect(r5).toBe(r1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves all concurrent calls cleanly when fetch rejects, calling fetch once', async () => {
    let rejectResponse: (err: any) => void;
    const delayedPromise = new Promise((_, reject) => {
      rejectResponse = reject;
    });

    const fetchMock = jest.spyOn(global, 'fetch').mockImplementationOnce(async () => {
      return delayedPromise as any;
    });

    // 5 concurrent calls on cold cache
    const call1 = service.getCatalog();
    const call2 = service.getCatalog();
    const call3 = service.getCatalog();
    const call4 = service.getCatalog();
    const call5 = service.getCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Reject the delayed fetch (e.g. ECONNREFUSED)
    rejectResponse!(new Error('TypeError: fetch failed ECONNREFUSED 127.0.0.1:4000'));

    const [r1, r2, r3, r4, r5] = await Promise.all([call1, call2, call3, call4, call5]);
    expect(r1.size).toBe(0);
    expect(r2.size).toBe(0);
    expect(r3.size).toBe(0);
    expect(r4.size).toBe(0);
    expect(r5.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry fetch within failure backoff window, but retries after backoff expires', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:4000');
    });

    const now = 1_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);

    // First call: fails, sets lastFailureAt = now
    const catalog1 = await service.getCatalog();
    expect(catalog1.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call within backoff (now + 5000 ms < 30000 ms backoff): returns empty without fetch
    jest.spyOn(Date, 'now').mockReturnValue(now + 5000);
    const catalog2 = await service.getCatalog();
    expect(catalog2.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // Not called again!

    // Third call after backoff (now + 31000 ms > 30000 ms backoff): retries fetch
    jest.spyOn(Date, 'now').mockReturnValue(now + 31000);
    const catalog3 = await service.getCatalog();
    expect(catalog3.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2); // Retried!
  });

  it('serves stale last-good catalog when gateway encounters an error after initial success', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce(modelInfoFixture),
    } as unknown as Response);

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    // Initial successful fetch
    const firstCatalog = await service.getCatalog();
    expect(firstCatalog.size).toBe(2);

    // Advance time past TTL
    jest.spyOn(Date, 'now').mockReturnValue(now + 300001);

    // Gateway throws on subsequent refresh
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Gateway 502 Bad Gateway'));

    const fallbackCatalog = await service.getCatalog();
    // Must return the stale last-good catalog instead of throwing or returning empty
    expect(fallbackCatalog.size).toBe(2);
    expect(fallbackCatalog.get('gpt-4o-mini')).toBeDefined();
  });

  it('falls back to explicit unknown model default when gateway is unreachable and no cache exists', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Gateway unreachable at http://127.0.0.1:4000'));

    const model = await service.getModel('unconfigured-model-xyz');
    expect(model.isUnknownDefault).toBe(true);
    expect(model.modelId).toBe('unconfigured-model-xyz');
    expect(model.maxInputTokens).toBe(4096);
    expect(model.maxOutputTokens).toBe(1024);
    expect(model.inputCostPerToken).toBeNull();
    expect(model.outputCostPerToken).toBeNull();
  });

  it('derives ModelContextPolicy from catalog entry', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce(modelInfoFixture),
    } as unknown as Response);

    const knownPolicy = await service.getModelContextPolicy('gpt-4o-mini');
    expect(knownPolicy.status).toBe('known');
    expect(knownPolicy.contextWindow).toBe(128000);
    expect(knownPolicy.defaultInputBudget).toBe(8192); // min(128000 * 0.5, 8192) = 8192
    expect(knownPolicy.reservedOutputTokens).toBe(16384);

    const maxBudget = await service.getMaxInputBudget('gpt-4o-mini');
    expect(maxBudget).toBe(128000 - 16384);

    const unknownPolicy = await service.getModelContextPolicy('random-llama-3');
    expect(unknownPolicy.status).toBe('unknown');
    expect(unknownPolicy.contextWindow).toBeNull();
    expect(unknownPolicy.defaultInputBudget).toBe(4096);
    expect(unknownPolicy.reservedOutputTokens).toBe(1024);
  });

  it('calculates cost from catalog estimate accurately and returns null for unknown models', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce(modelInfoFixture),
    } as unknown as Response);

    // gpt-4o-mini: 1000 input tokens * 0.00000015 = 0.00015
    //              500 output tokens * 0.00000060 = 0.00030
    // Total = 0.00045
    const costResult = await service.calculateCost('gpt-4o-mini', 1000, 500);
    expect(costResult.cost).toBe(0.00045);
    expect(costResult.costSource).toBe('catalog-estimate');

    const unknownResult = await service.calculateCost('nonexistent-model', 1000, 500);
    expect(unknownResult.cost).toBeNull();
    expect(unknownResult.costSource).toBe('catalog-estimate');
  });

  it('reports configured providers dynamically from catalog models', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce(modelInfoFixture),
    } as unknown as Response);

    const providers = await service.getConfiguredProviders();
    expect(providers).toEqual(['anthropic', 'openai']);
  });
});
