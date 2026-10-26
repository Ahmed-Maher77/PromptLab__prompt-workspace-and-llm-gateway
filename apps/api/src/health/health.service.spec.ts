import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../common/config/env.validation';
import { ModelCatalogService } from '../providers/model-catalog.service';

describe('HealthService', () => {
  let service: HealthService;
  let mockPrismaService: { checkHealth: jest.Mock };
  let mockConfigService: { get: jest.Mock };
  let mockModelCatalog: { getConfiguredProviders: jest.Mock };
  let mockAppConfig: { LITELLM_GATEWAY_URL: string; NODE_ENV: string; APP_VERSION: string };

  beforeEach(async () => {
    mockAppConfig = {
      LITELLM_GATEWAY_URL: 'http://localhost:4000',
      NODE_ENV: 'test',
      APP_VERSION: '0.1.0',
    };

    mockPrismaService = {
      checkHealth: jest.fn().mockResolvedValue({
        status: 'connected',
        latencyMs: 3,
      }),
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === 'LITELLM_PROXY_URL') return 'http://localhost:4000';
        if (key === 'NODE_ENV') return 'test';
        return defaultValue;
      }),
    };

    mockModelCatalog = {
      getConfiguredProviders: jest.fn().mockResolvedValue(['openai']),
    };

    // Mock global fetch to return 200 without network access
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as unknown as Response);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: ModelCatalogService,
          useValue: mockModelCatalog,
        },
        {
          provide: APP_CONFIG,
          useValue: mockAppConfig,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should evaluate connected database and available gateway', async () => {
    const health = await service.getHealth();
    expect(health.status).toBe('ok');
    expect(health.services.database.status).toBe('connected');
    expect(health.services.gateway.serviceAvailability).toBe('available');
    expect(health.services.gateway.providerReadiness.status).toBe('ready');
    expect(health.services.gateway.providerReadiness.configuredProviders).toEqual(['openai']);
  });

  it('should mark provider readiness as missing_provider_credentials when no keys are set', async () => {
    mockModelCatalog.getConfiguredProviders.mockResolvedValueOnce([]);

    const health = await service.getHealth();
    expect(health.services.gateway.providerReadiness.status).toBe('missing_provider_credentials');
    expect(health.services.gateway.providerReadiness.configuredProviders).toEqual([]);
  });

  it('should mark gateway as unreachable when fetch fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

    const health = await service.getHealth();
    expect(health.services.gateway.serviceAvailability).toBe('unreachable');
  });

  it('should mark status as degraded when database is disconnected', async () => {
    mockPrismaService.checkHealth.mockResolvedValueOnce({
      status: 'disconnected',
      latencyMs: 12,
      error: 'Database connection or query failed',
    });

    const health = await service.getHealth();
    expect(health.status).toBe('degraded');
    expect(health.services.database.status).toBe('disconnected');
    expect(health.services.database.error).toBe('Database connection or query failed');
  });

  it('reports gateway URL from appConfig', async () => {
    mockAppConfig.LITELLM_GATEWAY_URL = 'http://gateway.test:4000';

    const health = await service.getHealth();
    expect(health.services.gateway.url).toBe('http://gateway.test:4000');
  });

  it('falls back to default http://127.0.0.1:4000 when configured on appConfig', async () => {
    mockAppConfig.LITELLM_GATEWAY_URL = 'http://127.0.0.1:4000';

    const health = await service.getHealth();
    expect(health.services.gateway.url).toBe('http://127.0.0.1:4000');
  });

  describe('checkGatewayLiveness', () => {
    it('gives each probe its own fresh timeout signal', async () => {
      const signals: AbortSignal[] = [];
      global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
        signals.push(init!.signal as AbortSignal);
        return Promise.reject(new Error('down'));
      });

      const result = await service.checkGatewayLiveness('http://gateway.test:4000');

      expect(result.serviceAvailability).toBe('unreachable');
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(signals).toHaveLength(2);
      expect(signals[0]).not.toBe(signals[1]);
      // The fallback must not start out aborted (the old implementation reused an aborted controller).
      expect(signals[1].aborted).toBe(false);
    });

    it('falls back to /health when /health/liveliness fails', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new Error('liveliness timed out'))
        .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

      const result = await service.checkGatewayLiveness('http://gateway.test:4000/');

      expect(result.serviceAvailability).toBe('available');
      expect((global.fetch as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
        'http://gateway.test:4000/health/liveliness',
        'http://gateway.test:4000/health',
      ]);
    });

    it('treats 401 from the gateway as available (the process answered)', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 } as Response);
      await expect(service.checkGatewayLiveness('http://gateway.test:4000')).resolves.toMatchObject({
        serviceAvailability: 'available',
      });
    });

    it('reports not_configured without calling fetch when no URL is set', async () => {
      global.fetch = jest.fn();
      await expect(service.checkGatewayLiveness('')).resolves.toEqual({ serviceAvailability: 'not_configured' });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
