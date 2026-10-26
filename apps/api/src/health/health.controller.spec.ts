import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
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
      checkDatabase: jest.fn().mockResolvedValue({ status: 'connected', latencyMs: 2 }),
      checkGatewayLiveness: jest.fn().mockResolvedValue({ serviceAvailability: 'available', latencyMs: 5 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule.forRoot({ logger: false })],
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

  describe('liveness and readiness probes', () => {
    it('live returns ok without checking any dependency', async () => {
      const result = await controller.live();
      expect(result.status).toBe('ok');
      expect(healthService.checkDatabase).not.toHaveBeenCalled();
      expect(healthService.checkGatewayLiveness).not.toHaveBeenCalled();
    });

    it('live still returns ok when the database and gateway are down', async () => {
      jest.spyOn(healthService, 'checkDatabase').mockResolvedValue({ status: 'disconnected', latencyMs: 9 });
      jest.spyOn(healthService, 'checkGatewayLiveness').mockResolvedValue({ serviceAvailability: 'unreachable' });
      await expect(controller.live()).resolves.toMatchObject({ status: 'ok' });
    });

    it('ready returns ok with both dependencies up', async () => {
      const result = await controller.ready();
      expect(result.status).toBe('ok');
      expect(result.info).toMatchObject({ database: { status: 'up' }, gateway: { status: 'up' } });
    });

    it('ready throws 503 when the database is down', async () => {
      jest
        .spyOn(healthService, 'checkDatabase')
        .mockResolvedValue({ status: 'disconnected', latencyMs: 9, error: 'Database connection or query failed' });
      const err = await controller.ready().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      const body = (err as ServiceUnavailableException).getResponse() as Record<string, any>;
      expect(body.status).toBe('error');
      expect(body.error.database.status).toBe('down');
      expect(body.info.gateway.status).toBe('up');
    });

    it('ready throws 503 when the gateway is unreachable', async () => {
      jest.spyOn(healthService, 'checkGatewayLiveness').mockResolvedValue({ serviceAvailability: 'unreachable', latencyMs: 1200 });
      const err = await controller.ready().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      const body = (err as ServiceUnavailableException).getResponse() as Record<string, any>;
      expect(body.error.gateway).toMatchObject({ status: 'down', availability: 'unreachable' });
    });
  });
});
