import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HealthService, HealthResponse } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        HealthService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(HealthService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('fetches health data successfully', (done) => {
    const mockHealth: HealthResponse = {
      status: 'ok',
      timestamp: '2026-10-23T00:00:00Z',
      uptimeSeconds: 3600,
      environment: 'development',
      version: '0.1.0',
      services: {
        database: { status: 'connected', latencyMs: 5 },
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

    service.getHealth().subscribe((res) => {
      expect(res).toEqual(mockHealth);
      done();
    });

    const req = httpTesting.expectOne('/api/health');
    expect(req.request.method).toBe('GET');
    req.flush(mockHealth);
  });

  it('handles error gracefully and returns null without throwing', (done) => {
    service.getHealth().subscribe((res) => {
      expect(res).toBeNull();
      done();
    });

    const req = httpTesting.expectOne('/api/health');
    req.flush('Server Error', { status: 500, statusText: 'Internal Server Error' });
  });
});
