import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProvidersService } from './providers.service';
import { ModelCatalogService } from './model-catalog.service';
import { TokenCounterService } from '../tokens/token-counter.service';
import { APP_CONFIG } from '../common/config/env.validation';

describe('ProvidersService', () => {
  let service: ProvidersService;
  const mockConfigService = {
    get: jest.fn(),
  };
  const mockAppConfig = {
    LITELLM_GATEWAY_URL: 'http://127.0.0.1:4000',
    LITELLM_MASTER_KEY: 'sk-promptlab-dev-key',
    LLM_REQUEST_TIMEOUT_MS: 30000,
  };

  const mockModelCatalog = {
    getCatalog: jest.fn().mockResolvedValue(
      new Map([
        [
          'gpt-4o-mini',
          {
            modelId: 'gpt-4o-mini',
            provider: 'openai',
            maxInputTokens: 128000,
            maxOutputTokens: 16384,
            inputCostPerToken: 0.00000015,
            outputCostPerToken: 0.0000006,
          },
        ],
        [
          'claude-3-5-sonnet',
          {
            modelId: 'claude-3-5-sonnet',
            provider: 'anthropic',
            maxInputTokens: 200000,
            maxOutputTokens: 8192,
            inputCostPerToken: 0.000003,
            outputCostPerToken: 0.000015,
          },
        ],
      ]),
    ),
    getModel: jest.fn().mockImplementation(async (id: string) => {
      const lower = id.toLowerCase();
      if (lower === 'gpt-4o-mini') {
        return {
          modelId: 'gpt-4o-mini',
          provider: 'openai',
          maxInputTokens: 128000,
          maxOutputTokens: 16384,
          inputCostPerToken: 0.00000015,
          outputCostPerToken: 0.0000006,
        };
      }
      if (lower === 'claude-3-5-sonnet') {
        return {
          modelId: 'claude-3-5-sonnet',
          provider: 'anthropic',
          maxInputTokens: 200000,
          maxOutputTokens: 8192,
          inputCostPerToken: 0.000003,
          outputCostPerToken: 0.000015,
        };
      }
      return {
        modelId: id,
        provider: 'unknown',
        maxInputTokens: 4096,
        maxOutputTokens: 1024,
        inputCostPerToken: null,
        outputCostPerToken: null,
        isUnknownDefault: true,
      };
    }),
    calculateCost: jest.fn().mockImplementation(async (model: string, inputTokens: number, outputTokens: number) => {
      if (model === 'gpt-4o-mini') {
        return {
          cost: Math.round(((inputTokens * 0.00000015) + (outputTokens * 0.0000006)) * 1_000_000) / 1_000_000,
          costSource: 'catalog-estimate',
        };
      }
      return { cost: null, costSource: 'catalog-estimate' };
    }),
  };

  beforeEach(async () => {
    mockAppConfig.LITELLM_MASTER_KEY = 'sk-promptlab-dev-key';
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvidersService,
        TokenCounterService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: APP_CONFIG, useValue: mockAppConfig },
        { provide: ModelCatalogService, useValue: mockModelCatalog },
      ],
    }).compile();

    service = module.get<ProvidersService>(ProvidersService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return master key from config without hardcoded dev fallback (SEC-03b)', () => {
    expect(service.getMasterKey()).toBe('sk-promptlab-dev-key');

    mockAppConfig.LITELLM_MASTER_KEY = '';
    expect(service.getMasterKey()).toBe('');
  });

  it('should estimate token count appropriately based on length', () => {
    expect(service.estimateTokens('')).toBe(0);
    expect(service.estimateTokens('Hello world')).toBe(2);
    expect(service.estimateTokens('Hello world', 'gpt-4o')).toBe(2);
  });

  it('should successfully parse a valid completion response from LiteLLM with provider-reported cost header', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'Classification: Positive' } }],
      usage: { prompt_tokens: 14, completion_tokens: 4, total_tokens: 18 },
      model: 'gpt-4o-mini',
    };

    const mockHeaders = new Map<string, string>([
      ['x-litellm-response-cost', '0.000123'],
    ]);

    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (name: string) => mockHeaders.get(name.toLowerCase()) || null,
      },
      json: jest.fn().mockResolvedValueOnce(mockResponse),
    } as unknown as Response);

    const result = await service.executeChatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Is this good? Yes.' }],
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('Classification: Positive');
    expect(result.usage?.promptTokens).toBe(14);
    expect(result.usage?.completionTokens).toBe(4);
    expect(result.usage?.source).toBe('provider-reported');
    expect(result.cost).toBe(0.000123);
    expect(result.costSource).toBe('provider-reported');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should fall back to catalog-estimate cost when x-litellm-response-cost header is missing', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'Classification: Positive' } }],
      usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
      model: 'gpt-4o-mini',
    };

    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => null,
      },
      json: jest.fn().mockResolvedValueOnce(mockResponse),
    } as unknown as Response);

    const result = await service.executeChatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Estimate me' }],
    });

    expect(result.success).toBe(true);
    expect(result.cost).toBe(0.00045);
    expect(result.costSource).toBe('catalog-estimate');
    expect(mockModelCatalog.calculateCost).toHaveBeenCalledWith('gpt-4o-mini', 1000, 500);
  });

  it('should return explicit provider_auth_error when upstream provider credentials are unconfigured', async () => {
    const mockErrorBody = JSON.stringify({
      error: {
        message: 'OpenAIException - No API key provided. Set OPENAI_API_KEY environment variable.',
        type: 'authentication_error',
      },
    });

    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValueOnce(mockErrorBody),
    } as unknown as Response);

    const result = await service.executeChatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Test prompt' }],
    });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('provider_auth_error');
    expect(result.upstreamStatus).toBe(401);
    expect(result.configurationHint).toContain('OPENAI_API_KEY');
  });

  it('should return gateway models resolving provider from catalog (COST-01)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        data: [{ id: 'gpt-4o-mini' }, { id: 'claude-3-5-sonnet' }],
      }),
    } as unknown as Response);

    const result = await service.listModels();
    expect(result.gatewayConnected).toBe(true);
    expect(result.models.length).toBe(2);
    expect(result.models[0].provider).toBe('openai');
    expect(result.models[1].provider).toBe('anthropic');
  });

  describe('ERRCLS-01: Structural Gateway Error Classification', () => {
    const testCases: Array<{
      status: number;
      body: string;
      model: string;
      provider?: string;
      expectedErrorType: string;
      description: string;
    }> = [
      {
        status: 401,
        body: JSON.stringify({ error: { message: 'Invalid token' } }),
        model: 'gpt-4o-mini',
        provider: 'openai',
        expectedErrorType: 'provider_auth_error',
        description: 'HTTP 401 classifies as provider_auth_error',
      },
      {
        status: 403,
        body: JSON.stringify({ error: { message: 'Forbidden access' } }),
        model: 'claude-3-5-sonnet',
        provider: 'anthropic',
        expectedErrorType: 'provider_auth_error',
        description: 'HTTP 403 classifies as provider_auth_error',
      },
      {
        status: 429,
        body: JSON.stringify({ error: { message: 'Rate limit reached' } }),
        model: 'gpt-4o-mini',
        expectedErrorType: 'provider_rate_limited',
        description: 'HTTP 429 with no code classifies as provider_rate_limited',
      },
      {
        status: 429,
        body: JSON.stringify({ error: { message: 'Rate limit exceeded', code: 'rate_limit_exceeded' } }),
        model: 'gpt-4o-mini',
        expectedErrorType: 'provider_rate_limited',
        description: 'HTTP 429 with rate_limit_exceeded classifies as provider_rate_limited',
      },
      {
        status: 429,
        body: JSON.stringify({ error: { message: 'Rate limit error', code: 'rate_limit_error' } }),
        model: 'gpt-4o-mini',
        expectedErrorType: 'provider_rate_limited',
        description: 'HTTP 429 with rate_limit_error classifies as provider_rate_limited',
      },
      {
        status: 429,
        body: JSON.stringify({ error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } }),
        model: 'gpt-4o-mini',
        expectedErrorType: 'provider_quota_error',
        description: 'HTTP 429 with insufficient_quota classifies as provider_quota_error',
      },
      {
        status: 408,
        body: 'Request timeout',
        model: 'gpt-4o-mini',
        expectedErrorType: 'timeout',
        description: 'HTTP 408 classifies as timeout',
      },
      {
        status: 504,
        body: 'Gateway timeout',
        model: 'gpt-4o-mini',
        expectedErrorType: 'timeout',
        description: 'HTTP 504 classifies as timeout',
      },
      {
        status: 400,
        body: JSON.stringify({ error: { message: 'max_tokens must be positive' } }),
        model: 'gpt-4o-mini',
        expectedErrorType: 'invalid_request',
        description: 'HTTP 400 classifies as invalid_request',
      },
      {
        status: 422,
        body: JSON.stringify({ error: { message: 'Unprocessable entity' } }),
        model: 'gpt-4o-mini',
        expectedErrorType: 'invalid_request',
        description: 'HTTP 422 classifies as invalid_request',
      },
      {
        status: 500,
        body: JSON.stringify({ error: { message: 'Internal Server Error' } }),
        model: 'gpt-4o-mini',
        expectedErrorType: 'provider_error',
        description: 'HTTP 500 classifies as provider_error',
      },
      {
        status: 502,
        body: 'Bad Gateway',
        model: 'gpt-4o-mini',
        expectedErrorType: 'provider_error',
        description: 'HTTP 502 classifies as provider_error',
      },
      {
        status: 503,
        body: 'Service Unavailable',
        model: 'gpt-4o-mini',
        expectedErrorType: 'provider_error',
        description: 'HTTP 503 classifies as provider_error',
      },
      {
        status: 500,
        body: JSON.stringify({ error: { message: 'PostgreSQL quota table deadlocked' } }),
        model: 'gpt-4o-mini',
        expectedErrorType: 'provider_error',
        description: 'CRITICAL: HTTP 500 mentioning "quota" MUST NOT be classified as quota',
      },
      {
        status: 500,
        body: JSON.stringify({ error: { message: 'Internal api_key rotation service failed' } }),
        model: 'gpt-4o-mini',
        expectedErrorType: 'provider_error',
        description: 'CRITICAL: HTTP 500 mentioning "api_key" MUST NOT be classified as auth',
      },
    ];

    testCases.forEach(({ status, body, model, provider, expectedErrorType, description }) => {
      it(description, () => {
        const result = service.parseGatewayError(status, body, model, 120, provider);
        expect(result.errorType).toBe(expectedErrorType);
        expect(result.upstreamStatus).toBe(status);
        expect(result.success).toBe(false);
      });
    });

    it('falls back to structured error.type / error.code on non-standard HTTP status', () => {
      const quotaResult = service.parseGatewayError(
        418,
        JSON.stringify({ error: { code: 'insufficient_quota', message: 'Custom code' } }),
        'gpt-4o-mini',
        50,
      );
      expect(quotaResult.errorType).toBe('provider_quota_error');
      expect(quotaResult.upstreamStatus).toBe(418);

      const authResult = service.parseGatewayError(
        418,
        JSON.stringify({ error: { type: 'authentication_error', message: 'Custom type' } }),
        'gpt-4o-mini',
        50,
      );
      expect(authResult.errorType).toBe('provider_auth_error');
      expect(authResult.upstreamStatus).toBe(418);
    });
  });

  describe('getGatewayUrl', () => {
    it('returns configured LITELLM_GATEWAY_URL from appConfig', () => {
      mockAppConfig.LITELLM_GATEWAY_URL = 'http://gateway.internal:4000';
      expect(service.getGatewayUrl()).toBe('http://gateway.internal:4000');
    });

    it('returns default gateway URL from appConfig', () => {
      mockAppConfig.LITELLM_GATEWAY_URL = 'http://127.0.0.1:4000';
      expect(service.getGatewayUrl()).toBe('http://127.0.0.1:4000');
    });
  });
});
