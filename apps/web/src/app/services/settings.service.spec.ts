import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SettingsService, SystemSettings } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SettingsService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(SettingsService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('fetches system settings', (done) => {
    const mockSettings: SystemSettings = {
      application: {
        name: 'PromptLab',
        version: '0.1.0',
        environment: 'development',
        nodeVersion: 'v22.0.0',
        uptimeSeconds: 120,
        platform: 'win32',
      },
      gateway: {
        url: 'http://localhost:4000',
        connected: true,
        modelsConfigured: 2,
        models: [
          { id: 'gpt-4o-mini', provider: 'openai', name: 'GPT-4o Mini' },
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
        effectiveFrom: '2026-01-01T00:00:00Z',
      },
      observability: {
        telemetryEnabled: true,
        otelConfigured: false,
        otelEndpoint: null,
        langfuseConfigured: false,
        langfuseHost: null,
        privacyRedactionActive: true,
        tracesRecorded: 15,
      },
      security: {
        authMode: 'single-tenant-developer',
        defaultUser: 'dev-user-001 (Developer)',
        corsOrigins: 'http://localhost:4200',
        secretsExposed: false,
      },
    };

    service.getSettings().subscribe((res) => {
      expect(res.application.name).toBe('PromptLab');
      expect(res.security.secretsExposed).toBe(false);
      expect(res.gateway.models.length).toBe(1);
      done();
    });

    const req = httpTesting.expectOne('/api/settings');
    expect(req.request.method).toBe('GET');
    req.flush(mockSettings);
  });
});
