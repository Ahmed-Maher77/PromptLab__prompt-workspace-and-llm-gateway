import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsService } from './conversations.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { UsageService } from '../usage/usage.service';
import { ObservabilityService } from '../observability/observability.service';
import { LlmExecutionService } from '../llm/llm-execution.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('ConversationsService', () => {
  let service: ConversationsService;
  let mockPrisma: any;
  let mockProviders: any;

  beforeEach(async () => {
    mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u-1', email: 'dev@test.com' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'u-1', email: 'dev@test.com' }),
        create: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'u-1', email: 'dev@test.com' }),
      },
      conversation: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      conversationMessage: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      conversationCheckpoint: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      usageRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (actions: any) => {
        if (Array.isArray(actions)) {
          return Promise.all(actions);
        }
        return actions(mockPrisma);
      }),
    };
    mockPrisma.conversation.findFirst = mockPrisma.conversation.findUnique;

    mockProviders = {
      estimateTokens: jest.fn((text: string) => Math.max(1, Math.ceil((text || '').length / 4))),
      executeChatCompletion: jest.fn(),
    };

    const mockUsage = {
      reserveUsage: jest.fn().mockResolvedValue({ success: true }),
      reconcileUsage: jest.fn().mockResolvedValue({ success: true }),
    };

    const mockObservability = {
      startTrace: jest.fn().mockReturnValue({
        traceId: 'trace-conv',
        startSpan: jest.fn().mockReturnValue({ id: 'span-1', end: jest.fn() }),
        complete: jest.fn(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        LlmExecutionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProvidersService, useValue: mockProviders },
        { provide: UsageService, useValue: mockUsage },
        { provide: ObservabilityService, useValue: mockObservability },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
  });

  describe('create', () => {
    it('should create conversation and insert initial system prompt if provided', async () => {
      mockPrisma.conversation.create.mockResolvedValueOnce({
        id: 'c-1',
        title: 'Support Bot',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
      });

      mockPrisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c-1',
        title: 'Support Bot',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [
          {
            id: 'm-1',
            role: 'system',
            content: 'You are a helpful assistant.',
            sequenceNumber: 1,
          },
        ],
        checkpoints: [],
      });

      const result = await service.create({
        title: 'Support Bot',
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'You are a helpful assistant.',
      }, 'dev-user-001');

      expect(mockPrisma.conversation.create).toHaveBeenCalled();
      const callArg = mockPrisma.conversationMessage.create.mock.calls[0][0];
      expect(callArg.data.conversationId).toBe('c-1');
      expect(callArg.data.role).toBe('system');
      expect(callArg.data.content).toBe('You are a helpful assistant.');
      expect(callArg.data.sequenceNumber).toBe(1);
      expect(callArg.data.tokenUsageSource).toBe('estimated');
      expect(result.id).toBe('c-1');
      expect(result.messages.length).toBe(1);
    });
  });

  describe('inspectContext', () => {
    it('should show known context window for gpt-4o-mini and calculate honest token estimates', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c-1',
        title: 'Test Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        messages: [
          {
            id: 'm-1',
            role: 'system',
            content: 'You are a helpful coding assistant.',
            sequenceNumber: 1,
          },
          {
            id: 'm-2',
            role: 'user',
            content: 'How do I optimize SQL queries?',
            sequenceNumber: 2,
          },
          {
            id: 'm-3',
            role: 'assistant',
            content: 'Use indexes and avoid SELECT *.',
            sequenceNumber: 3,
          },
        ],
        checkpoints: [],
      });

      const inspection = await service.inspectContext('c-1', 'Tell me more about indexing', 'dev-user-001');

      expect(inspection.contextWindow).toBe(128_000);
      expect(inspection.contextLimitStatus).toBe('known');
      expect(inspection.tokenUsageSource).toBe('estimated');
      expect(inspection.totalEstimatedInputTokens).toBeGreaterThan(0);
      expect(inspection.withinBudget).toBe(true);
      expect(inspection.assembledMessages.length).toBe(4); // system + turn 1 + turn 2 + proposed input
    });

    it('should set contextWindow to null and status unknown for unregistered models', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c-custom',
        title: 'Custom Model Conv',
        provider: 'ollama',
        model: 'mistral-nemo-custom',
        status: 'active',
        messages: [],
        checkpoints: [],
      });

      const inspection = await service.inspectContext('c-custom', undefined, 'dev-user-001');

      expect(inspection.contextWindow).toBeNull();
      expect(inspection.contextLimitStatus).toBe('unknown');
    });

    it('should assemble compacted context incorporating checkpoint summary and retained facts', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c-compacted',
        title: 'Compacted Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        messages: [
          { id: 'm-1', role: 'system', content: 'Base system instruction', sequenceNumber: 1 },
          { id: 'm-2', role: 'user', content: 'Old question 1', sequenceNumber: 2 },
          { id: 'm-3', role: 'assistant', content: 'Old answer 1', sequenceNumber: 3 },
          { id: 'm-4', role: 'user', content: 'Recent question 2', sequenceNumber: 4 },
          { id: 'm-5', role: 'assistant', content: 'Recent answer 2', sequenceNumber: 5 },
        ],
        checkpoints: [
          {
            id: 'chk-1',
            conversationId: 'c-compacted',
            summary: 'User discussed setup and initial database schema configuration.',
            retainedFacts: ['PostgreSQL database is used', 'Auth uses JWT tokens'],
            compactedThroughSequence: 3,
            createdAt: new Date(),
          },
        ],
      });

      const inspection = await service.inspectContext('c-compacted', undefined, 'dev-user-001');

      expect(inspection.isCompacted).toBe(true);
      expect(inspection.activeCheckpoint?.compactedThroughSequence).toBe(3);
      expect(inspection.compactedMessagesCount).toBe(2); // m-2 and m-3
      expect(inspection.retainedMessagesCount).toBe(2); // m-4 and m-5

      // Assembled messages must contain system prompt, checkpoint summary, and uncompacted messages (4 and 5)
      const roles = inspection.assembledMessages.map((m) => m.role);
      expect(roles).toEqual(['system', 'system', 'user', 'assistant']);
      expect(inspection.assembledMessages[1].content).toContain('[CONVERSATION CHECKPOINT SUMMARY]');
      expect(inspection.assembledMessages[1].content).toContain('PostgreSQL database is used');
    });
  });

  describe('previewCompaction & applyCompaction', () => {
    const mockMessages = [
      { id: 'm-1', role: 'system', content: 'System instruction', sequenceNumber: 1 },
      { id: 'm-2', role: 'user', content: 'We need to design a billing API in TypeScript.', sequenceNumber: 2 },
      { id: 'm-3', role: 'assistant', content: 'Sure, we can use NestJS with Stripe webhooks.', sequenceNumber: 3 },
      { id: 'm-4', role: 'user', content: 'Remember that we require idempotency keys.', sequenceNumber: 4 },
      { id: 'm-5', role: 'assistant', content: 'Noted: all payment charges will require an Idempotency-Key header.', sequenceNumber: 5 },
      { id: 'm-6', role: 'user', content: 'What is the current status of the database?', sequenceNumber: 6 },
    ];

    it('should generate a proposed compaction preview with token savings', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c-billing',
        title: 'Billing Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        messages: mockMessages,
        checkpoints: [],
      });

      mockProviders.executeChatCompletion.mockResolvedValueOnce({
        success: true,
        model: 'gpt-4o-mini',
        content:
          'SUMMARY:\nThe user and assistant designed a TypeScript billing API using NestJS and Stripe webhooks.\n\n' +
          'FACTS:\n- Tech stack uses NestJS and TypeScript\n- All payment operations require Idempotency-Key headers',
      });

      const preview = await service.previewCompaction('c-billing', { compactThroughSequence: 4 }, 'dev-user-001');

      expect(preview.compactThroughSequence).toBe(4);
      expect(preview.messagesToCompactCount).toBe(3); // sequence 2, 3, 4
      expect(preview.proposedSummary).toContain('designed a TypeScript billing API');
      expect(preview.proposedRetainedFacts).toContain('Tech stack uses NestJS and TypeScript');
      expect(preview.proposedRetainedFacts).toContain('All payment operations require Idempotency-Key headers');
      expect(preview.estimatedTokensBefore).toBeGreaterThan(0);
    });

    it('should fall back gracefully to deterministic summary when provider fails without corrupting history', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c-billing',
        title: 'Billing Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        messages: mockMessages,
        checkpoints: [],
      });

      // Provider auth error simulation
      mockProviders.executeChatCompletion.mockResolvedValueOnce({
        success: false,
        errorType: 'provider_auth_error',
        errorMessage: 'Invalid API key',
      });

      const preview = await service.previewCompaction('c-billing', { compactThroughSequence: 4 }, 'dev-user-001');

      expect(preview.providerReported).toBe(false);
      expect(preview.providerError).toContain('Invalid API key');
      expect(preview.proposedSummary).toContain('Discussion between user and assistant across messages 2 through 4');
      expect(preview.proposedRetainedFacts.length).toBeGreaterThan(0);
    });

    it('should reject compaction if conversation has fewer than 3 messages', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c-short',
        title: 'Short Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        messages: [
          { id: 'm-1', role: 'system', content: 'system', sequenceNumber: 1 },
          { id: 'm-2', role: 'user', content: 'hello', sequenceNumber: 2 },
        ],
        checkpoints: [],
      });

      let thrownError: any = null;
      try {
        await service.previewCompaction('c-short', undefined, 'dev-user-001');
      } catch (err) {
        thrownError = err;
      }
      expect(thrownError).toBeDefined();
      expect(thrownError instanceof BadRequestException).toBe(true);
    });

    it('should apply compaction and persist checkpoint while retaining all original messages in database', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-billing',
        title: 'Billing Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        messages: mockMessages,
        checkpoints: [],
      });

      mockPrisma.conversationCheckpoint.create.mockResolvedValueOnce({
        id: 'chk-created',
        conversationId: 'c-billing',
        summary: 'Compact summary',
        retainedFacts: ['Fact 1', 'Fact 2'],
        compactedThroughSequence: 4,
        createdAt: new Date(),
      });

      mockPrisma.conversation.update.mockResolvedValueOnce({});

      const applied = await service.applyCompaction('c-billing', {
        summary: 'Compact summary',
        retainedFacts: ['Fact 1', 'Fact 2'],
        compactedThroughSequence: 4,
      }, 'dev-user-001');

      expect(applied.success).toBe(true);
      expect(mockPrisma.conversationCheckpoint.create).toHaveBeenCalled();
      const chkArg = mockPrisma.conversationCheckpoint.create.mock.calls[0][0];
      expect(chkArg.data.conversationId).toBe('c-billing');
      expect(chkArg.data.summary).toBe('Compact summary');
      expect(chkArg.data.compactedThroughSequence).toBe(4);
      // Verify no messages were deleted!
      expect(mockPrisma.conversationMessage.findMany).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('should persist user message and return provider error explicitly when provider fails', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-1',
        title: 'Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        messages: [
          { id: 'm-1', role: 'system', content: 'Sys', sequenceNumber: 1 },
        ],
        checkpoints: [],
      });

      mockPrisma.conversationMessage.create.mockResolvedValueOnce({
        id: 'm-2',
        role: 'user',
        content: 'Hi model',
        sequenceNumber: 2,
      });

      mockProviders.executeChatCompletion.mockResolvedValueOnce({
        success: false,
        errorType: 'provider_auth_error',
        errorMessage: 'Missing OpenAI credentials',
        configurationHint: 'Set OPENAI_API_KEY in environment',
      });

      const result = await service.sendMessage('c-1', { content: 'Hi model' }, 'dev-user-001');

      expect(result.success).toBe(false);
      expect(result.userMessage).toBeDefined();
      expect(result.assistantMessage).toBeNull();
      expect(result.errorMessage).toContain('Missing OpenAI credentials');
    });

    it('should append assistant response with provider-reported usage on success', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-1',
        title: 'Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        messages: [
          { id: 'm-1', role: 'system', content: 'Sys', sequenceNumber: 1 },
        ],
        checkpoints: [],
      });

      mockPrisma.conversationMessage.create
        .mockResolvedValueOnce({
          id: 'm-2',
          role: 'user',
          content: 'Hello assistant',
          sequenceNumber: 2,
        })
        .mockResolvedValueOnce({
          id: 'm-3',
          role: 'assistant',
          content: 'Hello! How can I help you today?',
          sequenceNumber: 3,
          tokenUsageSource: 'provider-reported',
        });

      mockProviders.executeChatCompletion.mockResolvedValueOnce({
        success: true,
        model: 'gpt-4o-mini',
        content: 'Hello! How can I help you today?',
        latencyMs: 320,
        usage: {
          promptTokens: 14,
          completionTokens: 8,
          totalTokens: 22,
          source: 'provider-reported',
        },
      });

      mockPrisma.conversation.update.mockResolvedValueOnce({});

      const result = await service.sendMessage('c-1', { content: 'Hello assistant' }, 'dev-user-001');

      expect(result.success).toBe(true);
      expect(result.assistantMessage).toBeDefined();
      expect(result.usage?.source).toBe('provider-reported');
      expect(result.latencyMs).toBe(320);
    });

    it('returns stored turn on replay without inserting new messages (QUOTA-05)', async () => {
      const storedUserMsg = { id: 'msg-u-1', role: 'user', content: 'Cached input', sequenceNumber: 1 };
      const storedAsstMsg = { id: 'msg-a-1', role: 'assistant', content: 'Cached output', sequenceNumber: 2 };

      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-replay',
        ownerId: 'dev-user-001',
        provider: 'gateway',
        model: 'gpt-4o-mini',
        messages: [storedUserMsg, storedAsstMsg],
        checkpoints: [],
      });

      // Mock llmExecutionService to return isReplay: true
      const llmService = (service as any).llmExecutionService;
      jest.spyOn(llmService, 'execute').mockResolvedValueOnce({
        success: true,
        content: 'Cached output',
        model: 'gpt-4o-mini',
        latencyMs: 150,
        requestId: 'req-replay-12345',
        isReplay: true,
      });

      mockPrisma.conversationMessage.findMany.mockResolvedValueOnce([
        storedUserMsg,
        storedAsstMsg,
      ]);

      const result = await service.sendMessage(
        'c-replay',
        { content: 'Cached input' },
        'dev-user-001',
        'req-replay-12345',
      );

      expect(result.success).toBe(true);
      expect(result.userMessage).toEqual(storedUserMsg);
      expect(result.assistantMessage).toEqual(storedAsstMsg);
      expect(mockPrisma.conversationMessage.findMany).toHaveBeenCalledWith({
        where: {
          conversationId: 'c-replay',
          requestId: 'req-replay-12345',
        },
        orderBy: { sequenceNumber: 'asc' },
      });
      expect(mockPrisma.conversationMessage.create).not.toHaveBeenCalled();
    });

    it('should throw 409 ConflictException when replayed request messages are not yet persisted', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-in-flight',
        ownerId: 'dev-user-001',
        provider: 'gateway',
        model: 'gpt-4o-mini',
        messages: [],
        checkpoints: [],
      });

      const llmService = (service as any).llmExecutionService;
      jest.spyOn(llmService, 'execute').mockResolvedValueOnce({
        success: true,
        content: 'Output',
        model: 'gpt-4o-mini',
        latencyMs: 150,
        requestId: 'req-in-flight-999',
        isReplay: true,
      });

      mockPrisma.conversationMessage.findMany.mockResolvedValueOnce([]);

      await expect(
        service.sendMessage(
          'c-in-flight',
          { content: 'Some input' },
          'dev-user-001',
          'req-in-flight-999',
        ),
      ).rejects.toThrow('REQUEST_IN_PROGRESS');
    });
  });

  describe('resume', () => {
    it('should restore conversation context confirmation with retained history intact', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-resume',
        title: 'Resume Test',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        messages: [
          { id: 'm-1', role: 'system', content: 'sys', sequenceNumber: 1 },
          { id: 'm-2', role: 'user', content: 'Initial setup', sequenceNumber: 2 },
          { id: 'm-3', role: 'assistant', content: 'Setup done', sequenceNumber: 3 },
        ],
        checkpoints: [
          {
            id: 'chk-resumed',
            conversationId: 'c-resume',
            summary: 'Setup finalized.',
            retainedFacts: ['Configured properly'],
            compactedThroughSequence: 3,
            createdAt: new Date(),
          },
        ],
      });

      const res = await service.resume('c-resume', 'chk-resumed', 'dev-user-001');

      expect(res.success).toBe(true);
      expect(res.activeCheckpoint?.id).toBe('chk-resumed');
      expect(res.originalMessagesRetained).toBe(3);
    });
  });
});
