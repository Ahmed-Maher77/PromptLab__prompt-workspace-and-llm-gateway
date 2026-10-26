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
});
