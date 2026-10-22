import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OverviewComponent } from './overview.component';
import { HealthService, HealthResponse } from '../../services/health.service';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

describe('OverviewComponent', () => {
  let component: OverviewComponent;
  let fixture: ComponentFixture<OverviewComponent>;
  let mockHealthService: any;

  const mockHealthData: HealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: 120,
    environment: 'development',
    version: '0.1.0',
    services: {
      database: {
        status: 'connected',
        latencyMs: 3,
      },
      gateway: {
        url: 'http://localhost:4000',
        serviceAvailability: 'available',
        latencyMs: 12,
        providerReadiness: {
          status: 'ready',
          configuredProviders: ['openai', 'anthropic'],
        },
      },
    },
  };

  beforeEach(async () => {
    mockHealthService = {
      getHealth: jasmine.createSpy('getHealth').and.returnValue(of(mockHealthData)),
    };

    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [
        { provide: HealthService, useValue: mockHealthService },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OverviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should load health data on initialization', () => {
    expect(mockHealthService.getHealth).toHaveBeenCalled();
    expect(component.healthData).toEqual(mockHealthData);
    expect(component.isLoading).toBe(false);
  });

  it('should handle health check failure gracefully', () => {
    mockHealthService.getHealth.and.returnValue(throwError(() => new Error('Network error')));
    component.refreshHealth();
    expect(component.healthData).toBeNull();
    expect(component.isLoading).toBe(false);
  });
});
