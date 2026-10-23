import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  PromptService,
  PromptSummary,
  PromptDetail,
  CreatePromptPayload,
  CreateVersionPayload,
  ResolvedPreview,
  PlaygroundRunResult,
} from './prompt.service';

describe('PromptService', () => {
  let service: PromptService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PromptService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(PromptService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('fetches prompt summaries with search and technique filters', (done) => {
    const mockSummaries: PromptSummary[] = [
      {
        id: 'p-1',
        name: 'Sentiment Classifier',
        description: 'Classifies text sentiment',
        techniques: ['few-shot'],
        versionCount: 2,
        latestVersionNumber: 2,
        latestTemplateBody: 'Classify {{text}}',
        createdAt: '2026-10-23T00:00:00Z',
        updatedAt: '2026-10-23T00:00:00Z',
        owner: { id: 'dev-user-001', displayName: 'Developer', email: 'dev@promptlab.local' },
      },
    ];

    service.getPrompts({ search: 'sentiment', technique: 'few-shot', limit: 10, offset: 0 }).subscribe((prompts) => {
      expect(prompts.length).toBe(1);
      expect(prompts[0].name).toBe('Sentiment Classifier');
      done();
    });

    const req = httpTesting.expectOne(
      (r) =>
        r.url === '/api/prompts' &&
        r.params.get('search') === 'sentiment' &&
        r.params.get('technique') === 'few-shot' &&
        r.params.get('limit') === '10' &&
        r.params.get('offset') === '0',
    );
    expect(req.request.method).toBe('GET');
    req.flush(mockSummaries);
  });

  it('fetches prompt detail by ID', (done) => {
    const mockDetail: PromptDetail = {
      id: 'p-1',
      name: 'Sentiment Classifier',
      description: 'Desc',
      techniques: ['few-shot'],
      createdAt: '2026-10-23T00:00:00Z',
      updatedAt: '2026-10-23T00:00:00Z',
      owner: { id: 'dev-user-001', displayName: 'Developer', email: 'dev@promptlab.local' },
      versions: [],
    };

    service.getPrompt('p-1').subscribe((detail) => {
      expect(detail.id).toBe('p-1');
      done();
    });

    const req = httpTesting.expectOne('/api/prompts/p-1');
    expect(req.request.method).toBe('GET');
    req.flush(mockDetail);
  });

  it('creates prompt and creates new version', (done) => {
    const createPayload: CreatePromptPayload = {
      name: 'New Prompt',
      templateBody: 'Template {{x}}',
      techniques: ['zero-shot'],
    };

    service.createPrompt(createPayload).subscribe((res) => {
      expect(res.name).toBe('New Prompt');
    });

    const req1 = httpTesting.expectOne('/api/prompts');
    expect(req1.request.method).toBe('POST');
    req1.flush({ id: 'p-2', name: 'New Prompt', versions: [] });

    const versionPayload: CreateVersionPayload = {
      templateBody: 'Template v2 {{x}}',
    };

    service.createVersion('p-2', versionPayload).subscribe((res) => {
      expect(res.id).toBe('p-2');
      done();
    });

    const req2 = httpTesting.expectOne('/api/prompts/p-2/versions');
    expect(req2.request.method).toBe('POST');
    req2.flush({ id: 'p-2', name: 'New Prompt', versions: [] });
  });

  it('previews prompt with interpolated variables', (done) => {
    const mockPreview: ResolvedPreview = {
      resolvedPrompt: 'Hello Bob',
      detectedVariables: ['name'],
      missingVariables: [],
      characterCount: 9,
      estimatedTokens: 3,
    };

    service.previewPrompt({ templateBody: 'Hello {{name}}', variables: { name: 'Bob' } }).subscribe((preview) => {
      expect(preview.resolvedPrompt).toBe('Hello Bob');
      expect(preview.estimatedTokens).toBe(3);
      done();
    });

    const req = httpTesting.expectOne('/api/prompts/preview');
    expect(req.request.method).toBe('POST');
    req.flush(mockPreview);
  });

  it('runs playground and fetches available models', (done) => {
    const mockRunResult: PlaygroundRunResult = {
      success: true,
      model: 'gpt-4o-mini',
      content: 'Generated output',
      latencyMs: 400,
      resolvedPrompt: 'Prompt text',
    };

    service.runPlayground({ templateBody: 'Prompt text', model: 'gpt-4o-mini' }).subscribe((result) => {
      expect(result.success).toBeTrue();
      expect(result.content).toBe('Generated output');
    });

    const req1 = httpTesting.expectOne('/api/prompts/run');
    expect(req1.request.method).toBe('POST');
    req1.flush(mockRunResult);

    service.getModels().subscribe((res) => {
      expect(res.gatewayConnected).toBeTrue();
      expect(res.models.length).toBe(1);
      done();
    });

    const req2 = httpTesting.expectOne('/api/providers/models');
    expect(req2.request.method).toBe('GET');
    req2.flush({ gatewayConnected: true, models: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' }] });
  });
});
