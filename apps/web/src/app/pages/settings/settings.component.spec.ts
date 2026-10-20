import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsComponent } from './settings.component';
import { SettingsService, SystemSettings } from '../../services/settings.service';
import { of, throwError } from 'rxjs';

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;
  let mockSettingsService: any;

  const mockSettings: SystemSettings = {
    application: {
      name: 'PromptLab',
      version: '0.1.0',
      environment: 'development',
      nodeVersion: 'v22.13.0',
      uptimeSeconds: 3665,
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
      latencyMs: 4,
    },
    quotaPolicy: {
      scope: 'user',
      scopeId: 'dev-user-001',
      monthlyTokenLimit: 100000,
      requestRateLimit: 60,
      effectiveFrom: '2026-10-01T00:00:00.000Z',
    },
    observability: {
      telemetryEnabled: true,
      otelConfigured: false,
      otelEndpoint: null,
      langfuseConfigured: false,
      langfuseHost: null,
      privacyRedactionActive: true,
      tracesRecorded: 12,
    },
    security: {
      authMode: 'single-tenant-developer',
      defaultUser: 'dev-user-001 (Developer)',
      corsOrigins: 'http://localhost:4200',
      secretsExposed: false,
    },
  };

  beforeEach(async () => {
    mockSettingsService = {
      getSettings: jasmine.createSpy('getSettings').and.returnValue(of(mockSettings)),
    };

    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [{ provide: SettingsService, useValue: mockSettingsService }],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load settings on init', () => {
    expect(component).toBeTruthy();
    expect(mockSettingsService.getSettings).toHaveBeenCalled();
    expect(component.settings).toEqual(mockSettings);
  });

  it('formats uptime correctly into hours, minutes, seconds', () => {
    expect(component.formatUptime(3665)).toBe('1h 1m 5s');
    expect(component.formatUptime(65)).toBe('1m 5s');
    expect(component.formatUptime(45)).toBe('45s');
  });

  it('renders gateway connection status and model catalog', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('LiteLLM Proxy Gateway');
    expect(compiled.textContent).toContain('gpt-4o-mini');
    expect(compiled.textContent).toContain('claude-3-5-sonnet');
    expect(compiled.textContent).toContain('100,000 tokens');
  });

  it('handles settings retrieval error gracefully', () => {
    mockSettingsService.getSettings.and.returnValue(
      throwError(() => ({ error: { message: 'Connection to backend failed' } })),
    );

    component.loadSettings();
    fixture.detectChanges();

    expect(component.errorMessage).toBe('Connection to backend failed');
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Connection to backend failed');
  });
});
