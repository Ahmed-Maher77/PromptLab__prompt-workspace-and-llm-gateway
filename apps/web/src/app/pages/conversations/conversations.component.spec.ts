import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ConversationsComponent } from './conversations.component';
import {
  ConversationService,
  ConversationDetail,
  ConversationSummary,
  ContextInspectionResult,
  CompactionPreviewResult,
  SendMessageResponse,
  ResumeResult,
} from '../../services/conversation.service';
import { PromptService } from '../../services/prompt.service';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

describe('ConversationsComponent', () => {
  let component: ConversationsComponent;
  let fixture: ComponentFixture<ConversationsComponent>;
  let mockConversationService: jasmine.SpyObj<ConversationService>;
  let mockPromptService: jasmine.SpyObj<PromptService>;

  const mockConversationsList: ConversationSummary[] = [
    {
      id: 'c-1',
      title: 'Architecture Discussion',
      provider: 'openai',
      model: 'gpt-4o-mini',
      status: 'active',
      createdAt: '2026-10-19T00:00:00Z',
      updatedAt: '2026-10-19T01:00:00Z',
      messageCount: 4,
      checkpointCount: 1,
      hasActiveCheckpoint: true,
      lastMessageSnippet: 'Understood, let us proceed.',
      lastMessageRole: 'assistant',
    },
    {
      id: 'c-2',
      title: 'Debugging Session',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      status: 'active',
      createdAt: '2026-10-19T02:00:00Z',
      updatedAt: '2026-10-19T02:30:00Z',
      messageCount: 2,
      checkpointCount: 0,
      hasActiveCheckpoint: false,
      lastMessageSnippet: 'Here is the stack trace',
      lastMessageRole: 'user',
    },
  ];

  const mockDetailC1: ConversationDetail = {
    id: 'c-1',
    title: 'Architecture Discussion',
    provider: 'openai',
    model: 'gpt-4o-mini',
    status: 'active',
    createdAt: '2026-10-19T00:00:00Z',
    updatedAt: '2026-10-19T01:00:00Z',
    messages: [
      {
        id: 'm-1',
        conversationId: 'c-1',
        role: 'system',
        content: 'You are an architecture assistant.',
        sequenceNumber: 1,
        createdAt: '2026-10-19T00:00:00Z',
      },
      {
        id: 'm-2',
        conversationId: 'c-1',
        role: 'user',
        content: 'We need to design a scalable event pipeline.',
        sequenceNumber: 2,
        createdAt: '2026-10-19T00:01:00Z',
      },
      {
        id: 'm-3',
        conversationId: 'c-1',
        role: 'assistant',
        content: 'I recommend using Kafka or Cloud Pub/Sub.',
        sequenceNumber: 3,
        inputTokens: 18,
        outputTokens: 12,
        tokenUsageSource: 'provider-reported',
        createdAt: '2026-10-19T00:02:00Z',
      },
      {
        id: 'm-4',
        conversationId: 'c-1',
        role: 'user',
        content: 'We selected Kafka for this POC.',
        sequenceNumber: 4,
        createdAt: '2026-10-19T00:03:00Z',
      },
    ],
    checkpoints: [
      {
        id: 'chk-1',
        conversationId: 'c-1',
        summary: 'User discussed event pipeline options and selected Kafka.',
        retainedFacts: ['Kafka selected as primary messaging broker'],
        compactedThroughSequence: 3,
        contextPolicyVersion: 'v1',
        createdAt: '2026-10-19T00:05:00Z',
      },
    ],
    activeCheckpoint: {
      id: 'chk-1',
      conversationId: 'c-1',
      summary: 'User discussed event pipeline options and selected Kafka.',
      retainedFacts: ['Kafka selected as primary messaging broker'],
      compactedThroughSequence: 3,
      contextPolicyVersion: 'v1',
      createdAt: '2026-10-19T00:05:00Z',
    },
  };

  const mockInspectionC1: ContextInspectionResult = {
    model: 'gpt-4o-mini',
    provider: 'openai',
    contextWindow: 128_000,
    contextLimitStatus: 'known',
    inputBudget: 8192,
    reservedOutputTokens: 1024,
    totalEstimatedInputTokens: 74,
    tokenUsageSource: 'estimated',
    isCompacted: true,
    activeCheckpoint: {
      id: 'chk-1',
      summary: 'User discussed event pipeline options and selected Kafka.',
      retainedFacts: ['Kafka selected as primary messaging broker'],
      compactedThroughSequence: 3,
      createdAt: '2026-10-19T00:05:00Z',
    },
    totalOriginalMessages: 4,
    retainedMessagesCount: 1,
    compactedMessagesCount: 2,
    truncatedMessagesCount: 0,
    assembledMessages: [
      {
        role: 'system',
        content: 'You are an architecture assistant.',
        source: 'system-instruction',
        sequenceNumber: 1,
        estimatedTokens: 8,
      },
      {
        role: 'system',
        content: '[CONVERSATION CHECKPOINT SUMMARY]\nUser discussed event pipeline options and selected Kafka.\n\n[RETAINED FACTS & DECISIONS]\n- Kafka selected as primary messaging broker',
        source: 'checkpoint-summary',
        sequenceNumber: 3,
        estimatedTokens: 42,
      },
      {
        role: 'user',
        content: 'We selected Kafka for this POC.',
        source: 'retained-message',
        sequenceNumber: 4,
        estimatedTokens: 24,
      },
    ],
    withinBudget: true,
    tokenEstimationMethod: 'tiktoken:o200k_base',
  };

  const mockCompactionPreview: CompactionPreviewResult = {
    conversationId: 'c-1',
    compactThroughSequence: 3,
    messagesToCompactCount: 2,
    estimatedTokensBefore: 30,
    estimatedTokensAfter: 15,
    tokenSavings: 15,
    proposedSummary: 'Discussion regarding event broker choices.',
    proposedRetainedFacts: ['Selected Kafka'],
    providerReported: true,
    providerError: null,
  };

  beforeEach(async () => {
    mockConversationService = jasmine.createSpyObj('ConversationService', [
      'getConversations',
      'getConversation',
      'createConversation',
      'deleteConversation',
      'inspectContext',
      'sendMessage',
      'previewCompaction',
      'applyCompaction',
      'resume',
      'estimateTokens',
    ]);

    mockPromptService = jasmine.createSpyObj('PromptService', ['getModels']);

    mockPromptService.getModels.and.returnValue(
      of({
        models: [
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
          { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
        ],
        gatewayConnected: true,
      }),
    );

    mockConversationService.getConversations.and.returnValue(of(mockConversationsList));
    mockConversationService.getConversation.and.returnValue(of(mockDetailC1));
    mockConversationService.inspectContext.and.returnValue(of(mockInspectionC1));
    mockConversationService.previewCompaction.and.returnValue(of(mockCompactionPreview));
    mockConversationService.estimateTokens.and.returnValue(
      of({ tokens: 3, method: 'tiktoken:o200k_base' }),
    );

    await TestBed.configureTestingModule({
      imports: [ConversationsComponent],
      providers: [
        provideRouter([]),
        { provide: ConversationService, useValue: mockConversationService },
        { provide: PromptService, useValue: mockPromptService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConversationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and automatically select the first conversation', () => {
    expect(component).toBeTruthy();
    expect(mockConversationService.getConversations).toHaveBeenCalled();
    expect(component.conversations().length).toBe(2);
    expect(component.selectedConversation()?.id).toBe('c-1');
  });

  it('should inspect active context and display honest token estimates and known limits', () => {
    component.openContextModal();

    expect(component.showContextModal()).toBeTrue();
    expect(mockConversationService.inspectContext).toHaveBeenCalledWith('c-1');
    const ctx = component.contextData();
    expect(ctx).not.toBeNull();
    expect(ctx?.contextLimitStatus).toBe('known');
    expect(ctx?.contextWindow).toBe(128_000);
    expect(ctx?.tokenUsageSource).toBe('estimated');
    expect(ctx?.isCompacted).toBeTrue();
    expect(ctx?.assembledMessages.length).toBe(3);
  });

  it('should send a user message and update conversation detail on success', () => {
    const mockSuccessResponse: SendMessageResponse = {
      success: true,
      userMessage: {
        id: 'm-5',
        conversationId: 'c-1',
        role: 'user',
        content: 'How should we partition topics?',
        sequenceNumber: 5,
        createdAt: '2026-10-19T00:10:00Z',
      },
      assistantMessage: {
        id: 'm-6',
        conversationId: 'c-1',
        role: 'assistant',
        content: 'Partition by customer ID for even distribution.',
        sequenceNumber: 6,
        inputTokens: 30,
        outputTokens: 10,
        tokenUsageSource: 'provider-reported',
        createdAt: '2026-10-19T00:10:05Z',
      },
      latencyMs: 340,
    };

    mockConversationService.sendMessage.and.returnValue(of(mockSuccessResponse));

    component.messageInput.set('How should we partition topics?');
    component.sendMessage();

    expect(mockConversationService.sendMessage).toHaveBeenCalledWith(
      'c-1',
      'How should we partition topics?',
      jasmine.stringMatching(/^[A-Za-z0-9._:-]{8,128}$/),
    );
    expect(component.messageInput()).toBe('');
    expect(component.sendingMessage()).toBeFalse();
    expect(component.currentSendMessageKey).toBeNull();
  });

  it('preserves idempotency key across retries on error until input changes (QUOTA-05b)', () => {
    component.selectedConversation.set({
      id: 'c-1',
      title: 'Active Conv',
      provider: 'openai',
      model: 'gpt-4o-mini',
      status: 'active',
      createdAt: '2026-10-19T00:00:00Z',
      updatedAt: '2026-10-19T00:00:00Z',
      messages: [],
      checkpoints: [],
      activeCheckpoint: null,
    });

    mockConversationService.sendMessage.and.returnValue(
      throwError(() => ({ error: { message: '503 Service Unavailable' }, status: 503 })),
    );

    component.messageInput.set('Retryable message');
    component.sendMessage();

    const firstKey = component.currentSendMessageKey;
    expect(firstKey).toBeTruthy();
    expect(component.chatError()).toContain('503 Service Unavailable');

    // Manual retry reuses the exact same key
    mockConversationService.sendMessage.calls.reset();
    component.retrySendMessage();
    expect(mockConversationService.sendMessage).toHaveBeenCalledWith(
      'c-1',
      'Retryable message',
      firstKey!,
    );

    // Changing the message input clears the key
    component.onMessageInputChange('Edited message input');
    expect(component.currentSendMessageKey).toBeNull();
  });

  it('preserves key on 409 REQUEST_IN_PROGRESS but rotates key on 409 IDEMPOTENCY_RESULT_UNAVAILABLE (CONV-02, QUOTA-05c)', () => {
    component.selectedConversation.set({
      id: 'c-1',
      title: 'Active Conv',
      provider: 'openai',
      model: 'gpt-4o-mini',
      status: 'active',
      createdAt: '2026-10-19T00:00:00Z',
      updatedAt: '2026-10-19T00:00:00Z',
      messages: [],
      checkpoints: [],
      activeCheckpoint: null,
    });

    // 1. 409 REQUEST_IN_PROGRESS (unknown outcome -> keep key)
    mockConversationService.sendMessage.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { code: 'REQUEST_IN_PROGRESS', message: 'In flight' },
      })),
    );

    component.messageInput.set('Check in flight');
    component.sendMessage();
    expect(component.currentSendMessageKey).toBeTruthy();

    // 2. 409 IDEMPOTENCY_RESULT_UNAVAILABLE (definitive outcome -> rotate/clear key)
    mockConversationService.sendMessage.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { code: 'IDEMPOTENCY_RESULT_UNAVAILABLE', message: 'Result unavailable' },
      })),
    );

    component.sendMessage();
    expect(component.currentSendMessageKey).toBeNull();
  });

  it('maps 409 CONTEXT_BUDGET_EXCEEDED to a friendly error message and rotates key', () => {
    component.selectedConversation.set({
      id: 'c-1',
      title: 'Active Conv',
      provider: 'openai',
      model: 'gpt-4o-mini',
      status: 'active',
      createdAt: '2026-10-19T00:00:00Z',
      updatedAt: '2026-10-19T00:00:00Z',
      messages: [],
      checkpoints: [],
      activeCheckpoint: null,
    });

    mockConversationService.sendMessage.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { code: 'CONTEXT_BUDGET_EXCEEDED', message: 'CONTEXT_BUDGET_EXCEEDED' },
      })),
    );

    component.messageInput.set('Massive message');
    component.sendMessage();

    expect(component.chatError()).toBe(
      "This message plus the pinned context exceeds the conversation's budget — compact history or shorten the message.",
    );
    expect(component.currentSendMessageKey).toBeNull();
  });

  it('calls debounced estimate endpoint and updates token estimate and method (TOKEN-01)', fakeAsync(() => {
    expect(component.currentInputTokensEstimate()).toBe(0);
    expect(component.isEstimateApproximate()).toBeFalse();

    component.onMessageInputChange('Hello world');
    tick(350);

    expect(mockConversationService.estimateTokens).toHaveBeenCalledWith(
      jasmine.objectContaining({ text: 'Hello world' }),
    );
    expect(component.currentInputTokensEstimate()).toBe(3);
    expect(component.inputTokensMethod()).toBe('tiktoken:o200k_base');
    expect(component.isEstimateApproximate()).toBeFalse();

    mockConversationService.estimateTokens.and.returnValue(
      of({ tokens: 18, method: 'approximate:o200k_base' }),
    );
    component.onMessageInputChange('Some text for claude');
    tick(350);

    expect(component.currentInputTokensEstimate()).toBe(18);
    expect(component.inputTokensMethod()).toBe('approximate:o200k_base');
    expect(component.isEstimateApproximate()).toBeTrue();

    mockConversationService.estimateTokens.calls.reset();
    component.onMessageInputChange('');
    expect(component.currentInputTokensEstimate()).toBe(0);
    expect(component.inputTokensMethod()).toBeNull();
    expect(mockConversationService.estimateTokens).not.toHaveBeenCalled();
  }));

  it('should handle provider errors explicitly when message fails without fabricating responses', () => {
    const mockFailResponse: SendMessageResponse = {
      success: false,
      userMessage: {
        id: 'm-5',
        conversationId: 'c-1',
        role: 'user',
        content: 'Trigger auth error',
        sequenceNumber: 5,
        createdAt: '2026-10-19T00:10:00Z',
      },
      assistantMessage: null,
      errorType: 'provider_auth_error',
      errorMessage: 'Missing API Key for OpenAI',
      configurationHint: 'Set OPENAI_API_KEY in environment',
    };

    mockConversationService.sendMessage.and.returnValue(of(mockFailResponse));

    component.messageInput.set('Trigger auth error');
    component.sendMessage();

    expect(component.chatError()).toContain('provider_auth_error');
    expect(component.chatError()).toContain('Missing API Key for OpenAI');
  });

  it('should open compaction modal and load proposed summary and token savings', () => {
    component.openCompactModal();

    expect(component.showCompactModal()).toBeTrue();
    expect(mockConversationService.previewCompaction).toHaveBeenCalledWith('c-1');
    expect(component.compactPreview()?.tokenSavings).toBe(15);
    expect(component.editableSummary).toBe('Discussion regarding event broker choices.');
    expect(component.editableFactsText).toContain('Selected Kafka');
  });

  it('should apply compaction and update checkpoint while preserving all original messages', () => {
    mockConversationService.applyCompaction.and.returnValue(of({ success: true }));

    component.openCompactModal();
    component.editableSummary = 'Approved summary of Kafka architecture';
    component.editableFactsText = 'Fact 1: Kafka chosen\nFact 2: 3 replicas';
    component.targetSequence = 3;

    component.applyCompaction();

    expect(mockConversationService.applyCompaction).toHaveBeenCalledWith('c-1', {
      summary: 'Approved summary of Kafka architecture',
      retainedFacts: ['Fact 1: Kafka chosen', 'Fact 2: 3 replicas'],
      compactedThroughSequence: 3,
    });
    expect(component.showCompactModal()).toBeFalse();
  });

  it('should resume conversation from a selected checkpoint and display confirmation', () => {
    const mockResumeResult: ResumeResult = {
      success: true,
      conversationId: 'c-1',
      title: 'Architecture Discussion',
      model: 'gpt-4o-mini',
      provider: 'openai',
      activeCheckpoint: mockDetailC1.checkpoints[0],
      contextInspection: mockInspectionC1,
      originalMessagesRetained: 4,
      message: 'Conversation resumed successfully.',
    };

    mockConversationService.resume.and.returnValue(of(mockResumeResult));

    component.resumeCheckpoint('chk-1');

    expect(mockConversationService.resume).toHaveBeenCalledWith('c-1', 'chk-1');
    expect(component.resumeMessage()).toContain('Resumed from checkpoint');
    expect(component.resumeMessage()).toContain('All 4 original messages remain safely stored in PostgreSQL');
  });

  it('should not display resume confirmation banner if resume API fails', () => {
    spyOn(window, 'alert');
    mockConversationService.resume.and.returnValue(
      throwError(() => ({ error: { message: 'Checkpoint not found' } })),
    );

    component.resumeMessage.set(null);
    component.resumeCheckpoint('chk-missing');

    expect(mockConversationService.resume).toHaveBeenCalledWith('c-1', 'chk-missing');
    expect(component.resumeMessage()).toBeNull();
    expect(window.alert).toHaveBeenCalledWith('Checkpoint not found');
  });

  it('marks active checkpoint in checkpoint drawer and displays active indicator', () => {
    component.showHistoryDrawer.set(true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const activeCard = compiled.querySelector('.checkpoint-card.active-chk');
    expect(activeCard).toBeTruthy();

    const activeBadge = compiled.querySelector('.active-badge');
    expect(activeBadge).toBeTruthy();
    expect(activeBadge?.textContent).toContain('Active');

    const activeIndicator = compiled.querySelector('.active-indicator');
    expect(activeIndicator).toBeTruthy();
    expect(activeIndicator?.textContent).toContain('Currently active in context');
  });

  it('should create a new conversation with custom title and initial system prompt', () => {
    mockConversationService.createConversation.and.returnValue(
      of({
        ...mockDetailC1,
        id: 'c-new',
        title: 'New API Design',
      }),
    );

    component.openNewModal();
    expect(component.showNewModal()).toBeTrue();

    component.newTitle = 'New API Design';
    component.newModel = 'gpt-4o-mini';
    component.newProvider = 'openai';
    component.newSystemPrompt = 'You are a REST API architect.';

    component.createNewConversation();

    expect(mockConversationService.createConversation).toHaveBeenCalledWith({
      title: 'New API Design',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'You are a REST API architect.',
    });
    expect(component.showNewModal()).toBeFalse();
  });
});
