import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ObservabilityService, ObservabilityStatus, TraceRecord } from './observability.service';

describe('ObservabilityService', () => {
  let service: ObservabilityService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ObservabilityService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(ObservabilityService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('fetches observability status', (done) => {
    const mockStatus: ObservabilityStatus = {
      telemetryEnabled: true,
      otelConfigured: false,
      otelEndpoint: null,
      langfuseConfigured: false,
      langfuseHost: null,
      totalTracesRecorded: 25,
      privacyRedactionActive: true,
      supportedTracedOperations: ['playground.execute', 'comparison.slot'],
    };

    service.getStatus().subscribe((status) => {
      expect(status.telemetryEnabled).toBeTrue();
      expect(status.totalTracesRecorded).toBe(25);
      done();
    });

    const req = httpTesting.expectOne('/api/observability/status');
    expect(req.request.method).toBe('GET');
    req.flush(mockStatus);
  });

  it('fetches traces with query filters', (done) => {
    const mockTraces: TraceRecord[] = [
      {
        id: 'trace-1',
        name: 'playground.execute',
        operation: 'playground.execute',
        status: 'success',
        startTime: '2026-10-23T00:00:00Z',
        endTime: '2026-10-23T00:00:01Z',
        durationMs: 1000,
        model: 'gpt-4o-mini',
        provider: 'openai',
        userId: 'dev-user-001',
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        tokenUsageSource: 'provider-reported',
        estimatedCost: 0.0001,
        errorCode: null,
        errorMessage: null,
        metadata: {},
        spans: [],
      },
    ];

    service.getTraces({ status: 'success', model: 'gpt-4o-mini', limit: 10 }).subscribe((traces) => {
      expect(traces.length).toBe(1);
      expect(traces[0].id).toBe('trace-1');
      done();
    });

    const req = httpTesting.expectOne(
      (r) =>
        r.url === '/api/observability/traces' &&
        r.params.get('status') === 'success' &&
        r.params.get('model') === 'gpt-4o-mini' &&
        r.params.get('limit') === '10',
    );
    expect(req.request.method).toBe('GET');
    req.flush(mockTraces);
  });

  it('fetches single trace by ID', (done) => {
    const mockTrace: TraceRecord = {
      id: 'trace-1',
      name: 'playground.execute',
      operation: 'playground.execute',
      status: 'success',
      startTime: '2026-10-23T00:00:00Z',
      endTime: '2026-10-23T00:00:01Z',
      durationMs: 1000,
      model: 'gpt-4o-mini',
      provider: 'openai',
      userId: 'dev-user-001',
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      tokenUsageSource: 'provider-reported',
      estimatedCost: 0.0001,
      errorCode: null,
      errorMessage: null,
      metadata: {},
      spans: [],
    };

    service.getTrace('trace-1').subscribe((trace) => {
      expect(trace.id).toBe('trace-1');
      done();
    });

    const req = httpTesting.expectOne('/api/observability/traces/trace-1');
    expect(req.request.method).toBe('GET');
    req.flush(mockTrace);
  });

  it('clears traces in memory', (done) => {
    service.clearTraces().subscribe((res) => {
      expect(res.success).toBeTrue();
      done();
    });

    const req = httpTesting.expectOne('/api/observability/clear');
    expect(req.request.method).toBe('POST');
    req.flush({ success: true, message: 'In-memory trace buffer cleared.' });
  });
});
