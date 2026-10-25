import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  ExperimentService,
  SavedExperimentSummary,
  RunComparisonPayload,
  ComparisonResult,
} from './experiment.service';

describe('ExperimentService', () => {
  let service: ExperimentService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ExperimentService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(ExperimentService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('fetches experiments with pagination', (done) => {
    const mockExperiments: SavedExperimentSummary[] = [
      {
        id: 'exp-1',
        name: 'Model Benchmark',
        createdAt: '2026-10-23T00:00:00Z',
        commonInput: { topic: 'climate' },
        evaluationCriteria: [],
        evaluations: {},
        runs: [],
      },
    ];

    service.getExperiments({ limit: 10, offset: 0 }).subscribe((res) => {
      expect(res.length).toBe(1);
      expect(res[0].id).toBe('exp-1');
      done();
    });

    const req = httpTesting.expectOne('/api/experiments?limit=10&offset=0');
    expect(req.request.method).toBe('GET');
    req.flush(mockExperiments);
  });

  it('fetches single experiment by ID', (done) => {
    const mockExperiment: SavedExperimentSummary = {
      id: 'exp-1',
      name: 'Model Benchmark',
      createdAt: '2026-10-23T00:00:00Z',
      commonInput: { topic: 'climate' },
      evaluationCriteria: [],
      evaluations: {},
      runs: [],
    };

    service.getExperiment('exp-1').subscribe((res) => {
      expect(res.id).toBe('exp-1');
      done();
    });

    const req = httpTesting.expectOne('/api/experiments/exp-1');
    expect(req.request.method).toBe('GET');
    req.flush(mockExperiment);
  });

  it('runs comparison and posts rating', (done) => {
    const payload: RunComparisonPayload = {
      name: 'Test Run',
      commonInput: { topic: 'AI' },
      slotA: { provider: 'openai', model: 'gpt-4o-mini' },
      slotB: { provider: 'anthropic', model: 'claude-3-5-sonnet' },
    };

    const mockComparison: ComparisonResult = {
      experimentId: 'exp-1',
      name: 'Test Run',
      createdAt: '2026-10-23T00:00:00Z',
      commonInput: { topic: 'AI' },
      slotA: {
        slot: 'A',
        provider: 'openai',
        model: 'gpt-4o-mini',
        resolvedPrompt: 'Topic: AI',
        status: 'completed',
        output: 'AI overview',
        latencyMs: 300,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        tokenUsageSource: 'provider-reported',
        estimatedCost: 0.0001,
        errorCode: null,
        criteriaResults: [],
      },
      slotB: {
        slot: 'B',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        resolvedPrompt: 'Topic: AI',
        status: 'completed',
        output: 'AI overview from Claude',
        latencyMs: 400,
        inputTokens: 10,
        outputTokens: 25,
        totalTokens: 35,
        tokenUsageSource: 'provider-reported',
        estimatedCost: 0.0002,
        errorCode: null,
        criteriaResults: [],
      },
    };

    service.runComparison(payload).subscribe((res) => {
      expect(res.experimentId).toBe('exp-1');
      expect(res.slotA.status).toBe('completed');
    });

    const req1 = httpTesting.expectOne('/api/experiments/run');
    expect(req1.request.method).toBe('POST');
    expect(req1.request.headers.has('Idempotency-Key')).toBeTrue();
    req1.flush(mockComparison);

    service.rateSlot('exp-1', 'A', 5, 'Great answer').subscribe((res) => {
      expect(res.success).toBeTrue();
      done();
    });

    const req2 = httpTesting.expectOne('/api/experiments/exp-1/rate');
    expect(req2.request.method).toBe('POST');
    expect(req2.request.body).toEqual({ slot: 'A', rating: 5, notes: 'Great answer' });
    req2.flush({ success: true });
  });
});
