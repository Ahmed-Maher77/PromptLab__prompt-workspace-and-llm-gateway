import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService, HealthCheckResult } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: HealthService;

  const mockHealthyResult: HealthCheckResult = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: 15,
    environment: 'test',
    version: '0.1.0',
    services: {
      database: {
        status: 'connected',
        latencyMs: 2,
      },
      gateway: {
        url: 'http://localhost:4000',
        serviceAvailability: 'available',
        latencyMs: 10,
        providerReadiness: {
          status: 'ready',
          configuredProviders: ['openai'],
        },
      },
    },
  };

  const mockDegradedResult: HealthCheckResult = {
    status: 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: 15,
    environment: 'test',
    version: '0.1.0',
    services: {
      database: {
        status: 'disconnected',
        latencyMs: 20,
        error: 'Database connection or query failed',
      },
      gateway: {
        url: 'http://localhost:4000',
        serviceAvailability: 'unreachable',
        providerReadiness: {
          status: 'missing_provider_credentials',
          configuredProviders: [],
        },
      },
    },
  };

  beforeEach(async () => {
    const mockHealthService = {
      getHealth: jest.fn().mockResolvedValue(mockHealthyResult),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: mockHealthService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthService = module.get<HealthService>(HealthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return ok status when services are healthy', async () => {
    const result: HealthCheckResult = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.services.database.status).toBe('connected');
    expect(result.services.gateway.serviceAvailability).toBe('available');
    expect(result.services.gateway.providerReadiness.status).toBe('ready');
  });

  it('should return degraded status when database is disconnected', async () => {
    jest.spyOn(healthService, 'getHealth').mockResolvedValueOnce(mockDegradedResult);

    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.services.database.status).toBe('disconnected');
    expect(result.services.database.error).toBe('Database connection or query failed');
    expect(result.services.gateway.serviceAvailability).toBe('unreachable');
  });
});
