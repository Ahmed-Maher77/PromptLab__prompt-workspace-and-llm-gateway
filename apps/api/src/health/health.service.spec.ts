import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthService', () => {
  let service: HealthService;
  let mockPrismaService: { checkHealth: jest.Mock };
  let mockConfigService: { get: jest.Mock };

  beforeEach(async () => {
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
        if (key === 'OPENAI_API_KEY') return 'sk-test-key';
        return defaultValue;
      }),
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
    mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
      if (key === 'LITELLM_PROXY_URL') return 'http://localhost:4000';
      if (key === 'NODE_ENV') return 'test';
      return defaultValue;
    });

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
});
