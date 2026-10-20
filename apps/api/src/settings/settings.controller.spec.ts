import { Test, TestingModule } from '@nestjs/testing';
import { SettingsController } from './settings.controller';
import { SettingsService, SystemSettingsResponse } from './settings.service';

describe('SettingsController', () => {
  let controller: SettingsController;
  let service: SettingsService;

  const mockSettings: SystemSettingsResponse = {
    application: {
      name: 'PromptLab',
      version: '0.1.0',
      environment: 'test',
      nodeVersion: process.version,
      uptimeSeconds: 120,
      platform: 'win32',
    },
    gateway: {
      url: 'http://127.0.0.1:4000',
      connected: true,
      modelsConfigured: 2,
      models: [
        { id: 'gpt-4o-mini', provider: 'openai', name: 'gpt-4o-mini' },
        { id: 'claude-3-5-sonnet', provider: 'anthropic', name: 'claude-3-5-sonnet' },
      ],
    },
    database: {
      type: 'PostgreSQL',
      connected: true,
      latencyMs: 3,
    },
    quotaPolicy: {
      scope: 'user',
      scopeId: 'dev-user-001',
      monthlyTokenLimit: 100000,
      requestRateLimit: 60,
      effectiveFrom: new Date().toISOString(),
    },
    observability: {
      telemetryEnabled: true,
      otelConfigured: false,
      otelEndpoint: null,
      langfuseConfigured: false,
      langfuseHost: null,
      privacyRedactionActive: true,
      tracesRecorded: 5,
    },
    security: {
      authMode: 'single-tenant-developer',
      defaultUser: 'dev-user-001 (Developer)',
      corsOrigins: 'http://localhost:4200',
      secretsExposed: false,
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        {
          provide: SettingsService,
          useValue: {
            getSettings: jest.fn().mockResolvedValue(mockSettings),
          },
        },
      ],
    }).compile();

    controller = module.get<SettingsController>(SettingsController);
    service = module.get<SettingsService>(SettingsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns safe system settings without exposing secrets', async () => {
    const result = await controller.getSettings();
    expect(result.application.name).toBe('PromptLab');
    expect(result.gateway.connected).toBe(true);
    expect(result.security.secretsExposed).toBe(false);

    // Explicitly verify no secret keys exist in the returned payload
    const jsonStr = JSON.stringify(result);
    expect(jsonStr).not.toContain('sk-');
    expect(jsonStr).not.toContain('password');
    expect(jsonStr).not.toContain('API_KEY');
  });
});
