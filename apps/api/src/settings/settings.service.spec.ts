import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from './settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { UsageService } from '../usage/usage.service';
import { ObservabilityService } from '../observability/observability.service';
import { DEFAULT_DEV_USER } from '../common/constants/auth.constants';
import { APP_CONFIG } from '../common/config/env.validation';

describe('SettingsService', () => {
  let service: SettingsService;
  let mockPrisma: { checkHealth: jest.Mock };
  let mockProviders: { listModels: jest.Mock; getGatewayUrl: jest.Mock };
  let mockUsage: { getPolicy: jest.Mock };
  let mockObservability: { getStatus: jest.Mock };
  let mockConfig: { get: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      checkHealth: jest.fn().mockResolvedValue({ status: 'connected', latencyMs: 5 }),
    };

    mockProviders = {
      listModels: jest.fn().mockResolvedValue({
        gatewayConnected: true,
        models: [
          { id: 'gpt-4o-mini', provider: 'openai', name: 'GPT-4o Mini' },
          { id: 'claude-3-5-sonnet', provider: 'anthropic', name: 'Claude 3.5 Sonnet' },
        ],
      }),
      getGatewayUrl: jest.fn().mockReturnValue('http://localhost:4000'),
    };

    mockUsage = {
      getPolicy: jest.fn().mockResolvedValue({
        scope: 'user',
        scopeId: DEFAULT_DEV_USER.id,
        monthlyTokenLimit: 150000,
        requestRateLimit: 120,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      }),
    };

    mockObservability = {
      getStatus: jest.fn().mockReturnValue({
        telemetryEnabled: true,
        otelConfigured: true,
        otelEndpoint: 'http://otel-collector:4318/v1/traces',
        langfuseConfigured: false,
        langfuseHost: null,
        privacyRedactionActive: true,
        totalTracesRecorded: 42,
      }),
    };

    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'CORS_ORIGIN') return 'http://localhost:4200, http://127.0.0.1:4200';
        if (key === 'NODE_ENV') return 'development';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProvidersService, useValue: mockProviders },
        { provide: UsageService, useValue: mockUsage },
        { provide: ObservabilityService, useValue: mockObservability },
        {
          provide: APP_CONFIG,
          useValue: {
            APP_VERSION: '0.1.0',
            NODE_ENV: 'development',
            CORS_ORIGIN: ['http://localhost:4200', 'http://127.0.0.1:4200'],
          },
        },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
  });

  it('aggregates system settings accurately and securely', async () => {
    const settings = await service.getSettings();

    expect(settings.application.name).toBe('PromptLab');
    expect(settings.application.environment).toBe('development');
    expect(settings.gateway.connected).toBe(true);
    expect(settings.gateway.modelsConfigured).toBe(2);
    expect(settings.database.connected).toBe(true);
    expect(settings.database.latencyMs).toBe(5);
    expect(settings.quotaPolicy.monthlyTokenLimit).toBe(150000);
    expect(settings.observability.tracesRecorded).toBe(42);
    expect(settings.observability.otelEndpoint).toBe('http://otel-collector:4318/v1/traces');
    expect(settings.security.secretsExposed).toBe(false);
    expect(settings.security.corsOrigins).toEqual(['http://localhost:4200', 'http://127.0.0.1:4200']);
  });

  it('falls back to default quota and safe status when optional services fail', async () => {
    mockUsage.getPolicy.mockRejectedValue(new Error('Quota table inaccessible'));

    const settings = await service.getSettings();

    expect(settings.quotaPolicy.scopeId).toBe(DEFAULT_DEV_USER.id);
    expect(settings.quotaPolicy.monthlyTokenLimit).toBe(100000);
  });
});
