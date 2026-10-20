import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProvidersService } from './providers.service';

describe('ProvidersService', () => {
  let service: ProvidersService;
  const mockConfigService = {
    get: jest.fn((key: string): string | null => {
      if (key === 'LITELLM_GATEWAY_URL') return 'http://127.0.0.1:4000';
      if (key === 'LITELLM_MASTER_KEY') return 'sk-promptlab-dev-key';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvidersService,
        { provide: ConfigService, useValue: mockConfigService },
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

  it('should estimate token count appropriately based on length', () => {
    expect(service.estimateTokens('')).toBe(0);
    expect(service.estimateTokens('Hello world')).toBe(3); // 11 / 4 ceil = 3
  });

  it('should successfully parse a valid completion response from LiteLLM', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'Classification: Positive' } }],
      usage: { prompt_tokens: 14, completion_tokens: 4, total_tokens: 18 },
      model: 'gpt-4o-mini',
    };

    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
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
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
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
    expect(result.configurationHint).toContain('OPENAI_API_KEY');
  });

  it('should return gateway models when gateway responds', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        data: [{ id: 'gpt-4o-mini', owned_by: 'openai' }],
      }),
    } as unknown as Response);

    const result = await service.listModels();
    expect(result.gatewayConnected).toBe(true);
    expect(result.models.length).toBe(1);
    expect(result.models[0].id).toBe('gpt-4o-mini');
  });

  it('should handle empty model list from gateway gracefully', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({ data: [] }),
    } as unknown as Response);

    const result = await service.listModels();
    expect(result.gatewayConnected).toBe(true);
    expect(result.models).toEqual([]);
  });

  it('should return empty list and gatewayConnected false when gateway call fails', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Gateway down'));

    const result = await service.listModels();
    expect(result.gatewayConnected).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.error).toContain('Gateway down');
  });

  describe('getGatewayUrl', () => {
    it('prefers LITELLM_GATEWAY_URL when explicitly configured', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'LITELLM_GATEWAY_URL') return 'http://gateway.internal:4000';
        if (key === 'LITELLM_PROXY_URL') return 'http://proxy.internal:4000';
        return null;
      });

      expect(service.getGatewayUrl()).toBe('http://gateway.internal:4000');
    });

    it('falls back to LITELLM_PROXY_URL when LITELLM_GATEWAY_URL is not set', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'LITELLM_PROXY_URL') return 'http://proxy.internal:4000';
        return null;
      });

      expect(service.getGatewayUrl()).toBe('http://proxy.internal:4000');
    });

    it('falls back to default localhost URL when neither variable is set', () => {
      mockConfigService.get.mockImplementation(() => null);

      expect(service.getGatewayUrl()).toBe('http://127.0.0.1:4000');
    });
  });
});
