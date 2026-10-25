import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  ConversationService,
  ConversationSummary,
  ConversationDetail,
  CreateConversationPayload,
  ContextInspectionResult,
  SendMessageResponse,
  CompactionPreviewResult,
  ApplyCompactionPayload,
  ResumeResult,
} from './conversation.service';

describe('ConversationService', () => {
  let service: ConversationService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ConversationService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(ConversationService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('fetches conversations with pagination', (done) => {
    const mockList: ConversationSummary[] = [
      {
        id: 'c-1',
        title: 'Architecture Discussion',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        createdAt: '2026-10-23T00:00:00Z',
        updatedAt: '2026-10-23T00:00:00Z',
        messageCount: 3,
        checkpointCount: 0,
        hasActiveCheckpoint: false,
        lastMessageSnippet: 'Hello',
        lastMessageRole: 'user',
      },
    ];

    service.getConversations({ limit: 10, offset: 0 }).subscribe((res) => {
      expect(res.length).toBe(1);
      expect(res[0].id).toBe('c-1');
      done();
    });

    const req = httpTesting.expectOne('/api/conversations?limit=10&offset=0');
    expect(req.request.method).toBe('GET');
    req.flush(mockList);
  });

  it('fetches single conversation detail and deletes it', (done) => {
    const mockDetail: ConversationDetail = {
      id: 'c-1',
      title: 'Architecture Discussion',
      provider: 'openai',
      model: 'gpt-4o-mini',
      status: 'active',
      createdAt: '2026-10-23T00:00:00Z',
      updatedAt: '2026-10-23T00:00:00Z',
      messages: [],
      checkpoints: [],
      activeCheckpoint: null,
    };

    service.getConversation('c-1').subscribe((detail) => {
      expect(detail.id).toBe('c-1');
    });

    const getReq = httpTesting.expectOne('/api/conversations/c-1');
    expect(getReq.request.method).toBe('GET');
    getReq.flush(mockDetail);

    service.deleteConversation('c-1').subscribe((res) => {
      expect(res.success).toBeTrue();
      done();
    });

    const delReq = httpTesting.expectOne('/api/conversations/c-1');
    expect(delReq.request.method).toBe('DELETE');
    delReq.flush({ success: true, id: 'c-1' });
  });

  it('creates conversation and sends message', (done) => {
    const createPayload: CreateConversationPayload = {
      title: 'New Chat',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'You are helpful',
    };

    service.createConversation(createPayload).subscribe((res) => {
      expect(res.title).toBe('New Chat');
    });

    const createReq = httpTesting.expectOne('/api/conversations');
    expect(createReq.request.method).toBe('POST');
    createReq.flush({ id: 'c-2', title: 'New Chat', messages: [], checkpoints: [], activeCheckpoint: null });

    const mockMessageResponse: SendMessageResponse = {
      success: true,
      userMessage: {
        id: 'm-1',
        conversationId: 'c-2',
        role: 'user',
        content: 'Hi',
        sequenceNumber: 1,
        createdAt: '2026-10-23T00:00:00Z',
      },
      assistantMessage: {
        id: 'm-2',
        conversationId: 'c-2',
        role: 'assistant',
        content: 'Hello there!',
        sequenceNumber: 2,
        createdAt: '2026-10-23T00:00:01Z',
      },
    };

    service.sendMessage('c-2', 'Hi').subscribe((res) => {
      expect(res.success).toBeTrue();
      expect(res.assistantMessage?.content).toBe('Hello there!');
      done();
    });

    const msgReq = httpTesting.expectOne('/api/conversations/c-2/messages');
    expect(msgReq.request.method).toBe('POST');
    expect(msgReq.request.headers.has('Idempotency-Key')).toBeTrue();
    expect(msgReq.request.body).toEqual({ content: 'Hi' });
    msgReq.flush(mockMessageResponse);
  });

  it('retries transient 503 error using the same Idempotency-Key', fakeAsync(() => {
    let response: any = null;
    service.sendMessage('c-2', 'Hi', 'idemp-custom-key').subscribe((res) => {
      response = res;
    });

    const req1 = httpTesting.expectOne('/api/conversations/c-2/messages');
    expect(req1.request.headers.get('Idempotency-Key')).toBe('idemp-custom-key');
    req1.flush('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });

    tick(600);

    const req2 = httpTesting.expectOne('/api/conversations/c-2/messages');
    expect(req2.request.headers.get('Idempotency-Key')).toBe('idemp-custom-key');
    req2.flush({ success: true, userMessage: { content: 'Hi' } });

    expect(response?.success).toBeTrue();
  }));

  it('inspects context with proposed input parameter', (done) => {
    const mockContext: ContextInspectionResult = {
      model: 'gpt-4o-mini',
      provider: 'openai',
      contextWindow: 128000,
      contextLimitStatus: 'known',
      inputBudget: 8192,
      reservedOutputTokens: 1024,
      totalEstimatedInputTokens: 50,
      tokenUsageSource: 'estimated',
      isCompacted: false,
      activeCheckpoint: null,
      totalOriginalMessages: 2,
      retainedMessagesCount: 2,
      compactedMessagesCount: 0,
      assembledMessages: [],
      withinBudget: true,
    };

    service.inspectContext('c-1', 'How to test?').subscribe((ctx) => {
      expect(ctx.contextLimitStatus).toBe('known');
      expect(ctx.withinBudget).toBeTrue();
      done();
    });

    const req = httpTesting.expectOne('/api/conversations/c-1/context?proposedInput=How%20to%20test%3F');
    expect(req.request.method).toBe('GET');
    req.flush(mockContext);
  });

  it('handles compaction preview, apply, and resume', (done) => {
    const mockPreview: CompactionPreviewResult = {
      conversationId: 'c-1',
      compactThroughSequence: 3,
      messagesToCompactCount: 2,
      estimatedTokensBefore: 100,
      estimatedTokensAfter: 40,
      tokenSavings: 60,
      proposedSummary: 'Summary',
      proposedRetainedFacts: ['Fact 1'],
      providerReported: true,
      providerError: null,
    };

    service.previewCompaction('c-1', 3).subscribe((res) => {
      expect(res.tokenSavings).toBe(60);
    });

    const previewReq = httpTesting.expectOne('/api/conversations/c-1/compact/preview');
    expect(previewReq.request.method).toBe('POST');
    expect(previewReq.request.headers.has('Idempotency-Key')).toBeTrue();
    previewReq.flush(mockPreview);

    const applyPayload: ApplyCompactionPayload = {
      summary: 'Summary',
      retainedFacts: ['Fact 1'],
      compactedThroughSequence: 3,
    };

    service.applyCompaction('c-1', applyPayload).subscribe((res) => {
      expect(res.success).toBeTrue();
    });

    const applyReq = httpTesting.expectOne('/api/conversations/c-1/compact/apply');
    expect(applyReq.request.method).toBe('POST');
    applyReq.flush({ success: true });

    service.resume('c-1', 'chk-1').subscribe((res) => {
      expect(res.success).toBeTrue();
      done();
    });

    const resumeReq = httpTesting.expectOne('/api/conversations/c-1/resume?checkpointId=chk-1');
    expect(resumeReq.request.method).toBe('POST');
    resumeReq.flush({ success: true, conversationId: 'c-1', message: 'Resumed' });
  });
});
