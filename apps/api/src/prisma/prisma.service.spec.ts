jest.mock('@prisma/client', () => {
  return {
    PrismaClient: class MockPrismaClient {
      $connect = jest.fn();
      $disconnect = jest.fn();
      $queryRaw = jest.fn();
    },
  };
});

import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(() => {
    service = new PrismaService();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  it('connects to database on module init', async () => {
    const connectSpy = jest.spyOn(service, '$connect').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  it('handles connection error gracefully during eager init without crashing', async () => {
    jest.spyOn(service, '$connect').mockRejectedValue(new Error('Connection refused'));

    let errorThrown = false;
    try {
      await service.onModuleInit();
    } catch {
      errorThrown = true;
    }
    expect(errorThrown).toBe(false);
  });

  it('disconnects from database on module destroy', async () => {
    const disconnectSpy = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);

    await service.onModuleDestroy();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  it('returns connected status and measured latency on successful health check', async () => {
    jest.spyOn(service, '$queryRaw').mockResolvedValue([{ '?column?': 1 }]);

    const result = await service.checkHealth();

    expect(result.status).toBe('connected');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('returns disconnected status on health check failure', async () => {
    jest.spyOn(service, '$queryRaw').mockRejectedValue(new Error('DB unreachable'));

    const result = await service.checkHealth();

    expect(result.status).toBe('disconnected');
    expect(result.error).toBe('Database connection or query failed');
  });
});
