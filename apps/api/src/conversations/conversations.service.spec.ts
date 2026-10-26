import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsService } from './conversations.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { ModelCatalogService } from '../providers/model-catalog.service';
import { UsageService } from '../usage/usage.service';
import { ObservabilityService } from '../observability/observability.service';
import { LlmExecutionService } from '../llm/llm-execution.service';
import { TokenCounterService } from '../tokens/token-counter.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { assembleConversationContext } from './context-policy';

describe('ConversationsService', () => {
  let service: ConversationsService;
  let mockPrisma: any;
  let mockProviders: any;
  let mockModelCatalog: any;

  beforeEach(async () => {
    mockModelCatalog = {
      getModel: jest.fn().mockImplementation(async (id: string) => {
        if (id.toLowerCase() === 'gpt-4o-mini') {
          return {
            modelId: 'gpt-4o-mini',
            provider: 'openai',
            maxInputTokens: 128000,
            maxOutputTokens: 16384,
            inputCostPerToken: 0.00000015,
            outputCostPerToken: 0.0000006,
          };
        }
        return {
          modelId: id,
          provider: 'unknown',
          maxInputTokens: null,
          maxOutputTokens: 1024,
          inputCostPerToken: null,
          outputCostPerToken: null,
          isUnknownDefault: true,
        };
      }),
      getModelContextPolicy: jest.fn().mockImplementation(async (id: string) => {
        if (id.toLowerCase() === 'gpt-4o-mini') {
          return {
            contextWindow: 128000,
            status: 'known',
            defaultInputBudget: 8192,
            reservedOutputTokens: 1024,
          };
        }
        return {
          contextWindow: null,
          status: 'unknown',
          defaultInputBudget: 4096,
          reservedOutputTokens: 1024,
        };
      }),
      getMaxInputBudget: jest.fn().mockImplementation(async (id: string) => {
        if (id.toLowerCase() === 'gpt-4o-mini') {
          return 128000 - 1024;
        }
        return 4096;
      }),
      calculateCost: jest.fn().mockResolvedValue({ cost: 0.001, costSource: 'catalog-estimate' }),
    };

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
        update: jest.fn().mockImplementation(async (args: any) => {
          const inc = args?.data?.lastSequence?.increment ?? 0;
          return {
            id: args?.where?.id,
            lastSequence: inc > 0 ? 1 + inc : 2,
            ...args?.data,
          };
        }),
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
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'c-1' }]),
      $transaction: jest.fn(async (actions: any) => {
        if (Array.isArray(actions)) {
          return Promise.all(actions);
        }
        return actions(mockPrisma);
      }),
    };
    mockPrisma.conversation.findFirst = mockPrisma.conversation.findUnique;
    mockPrisma.usageRecord.findFirst = mockPrisma.usageRecord.findUnique;

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
        TokenCounterService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProvidersService, useValue: mockProviders },
        { provide: ModelCatalogService, useValue: mockModelCatalog },
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

    it('should exclude failed messages from assembled context and retained count (CONV-02)', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'c-failed-ctx',
        title: 'Failed Context Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        messages: [
          { id: 'm-1', role: 'system', content: 'Base system', sequenceNumber: 1, status: 'complete' },
          { id: 'm-2', role: 'user', content: 'Successful turn 1', sequenceNumber: 2, status: 'complete' },
          { id: 'm-3', role: 'assistant', content: 'Answer 1', sequenceNumber: 3, status: 'complete' },
          { id: 'm-4', role: 'user', content: 'Failed turn 2', sequenceNumber: 4, status: 'failed' },
          { id: 'm-5', role: 'user', content: 'Successful turn 3', sequenceNumber: 5, status: 'complete' },
          { id: 'm-6', role: 'assistant', content: 'Answer 3', sequenceNumber: 6, status: 'complete' },
        ],
        checkpoints: [],
      });

      const inspection = await service.inspectContext('c-failed-ctx', undefined, 'dev-user-001');

      // m-4 is failed, so assembled messages must only contain m-1, m-2, m-3, m-5, m-6
      expect(inspection.assembledMessages.some((m) => m.content === 'Failed turn 2')).toBe(false);
      expect(inspection.assembledMessages.map((m) => m.content)).toEqual([
        'Base system',
        'Successful turn 1',
        'Answer 1',
        'Successful turn 3',
        'Answer 3',
      ]);
      expect(inspection.retainedMessagesCount).toBe(4); // m-2, m-3, m-5, m-6
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

    it('treats P2002 as already persisted only when meta.target matches requestId', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-racing',
        ownerId: 'dev-user-001',
        provider: 'gateway',
        model: 'gpt-4o-mini',
        messages: [],
        checkpoints: [],
      });

      const llmService = (service as any).llmExecutionService;
      jest.spyOn(llmService, 'execute').mockResolvedValueOnce({
        success: true,
        content: 'Racing output',
        model: 'gpt-4o-mini',
        latencyMs: 120,
        requestId: 'req-racing-target',
        isReplay: false,
      });

      const p2002Error: any = new Error('Unique constraint failed on the fields: (`requestId`)');
      p2002Error.code = 'P2002';
      p2002Error.meta = { target: ['conversationId', 'requestId', 'role'] };

      mockPrisma.conversationMessage.create.mockRejectedValueOnce(p2002Error);

      const persistedUserMsg = { id: 'm-u', role: 'user', content: 'Racing input', sequenceNumber: 1 };
      const persistedAsstMsg = { id: 'm-a', role: 'assistant', content: 'Racing output', sequenceNumber: 2 };
      mockPrisma.conversationMessage.findMany.mockResolvedValueOnce([persistedUserMsg, persistedAsstMsg]);

      const result = await service.sendMessage(
        'c-racing',
        { content: 'Racing input' },
        'dev-user-001',
        'req-racing-target',
      );

      expect(result.success).toBe(true);
      expect(result.userMessage).toEqual(persistedUserMsg);
      expect(result.assistantMessage).toEqual(persistedAsstMsg);
    });

    it('rethrows P2002 when meta.target indicates sequenceNumber collision', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-seq-collision',
        ownerId: 'dev-user-001',
        provider: 'gateway',
        model: 'gpt-4o-mini',
        messages: [],
        checkpoints: [],
      });

      const llmService = (service as any).llmExecutionService;
      jest.spyOn(llmService, 'execute').mockResolvedValueOnce({
        success: true,
        content: 'Collision output',
        model: 'gpt-4o-mini',
        latencyMs: 120,
        requestId: 'req-seq-collision',
        isReplay: false,
      });

      const seqP2002Error: any = new Error('Unique constraint failed on (conversationId, sequenceNumber)');
      seqP2002Error.code = 'P2002';
      seqP2002Error.meta = { target: ['conversationId', 'sequenceNumber'] };

      mockPrisma.conversationMessage.create.mockRejectedValueOnce(seqP2002Error);

      await expect(
        service.sendMessage(
          'c-seq-collision',
          { content: 'Collision input' },
          'dev-user-001',
          'req-seq-collision',
        ),
      ).rejects.toThrow('Unique constraint failed on (conversationId, sequenceNumber)');
    });

    it('persists user message with status failed on provider failure (CONV-02)', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-fail',
        ownerId: 'dev-user-001',
        provider: 'gateway',
        model: 'gpt-4o-mini',
        messages: [],
        checkpoints: [],
      });

      const llmService = (service as any).llmExecutionService;
      jest.spyOn(llmService, 'execute').mockResolvedValueOnce({
        success: false,
        errorMessage: 'Provider rate limit exceeded',
        errorType: 'RATE_LIMIT',
        model: 'gpt-4o-mini',
        latencyMs: 100,
        requestId: 'req-failed-turn',
      });

      const userMsgCreated = {
        id: 'msg-u-failed',
        role: 'user',
        content: 'Failing prompt',
        status: 'failed',
        sequenceNumber: 1,
      };
      mockPrisma.conversationMessage.create.mockResolvedValueOnce(userMsgCreated);

      const res = await service.sendMessage(
        'c-fail',
        { content: 'Failing prompt' },
        'dev-user-001',
        'req-failed-turn',
      );

      expect(res.success).toBe(false);
      expect(res.errorMessage).toBe('Provider rate limit exceeded');
      expect(mockPrisma.conversationMessage.create).toHaveBeenCalledTimes(1);
      const call = mockPrisma.conversationMessage.create.mock.calls[0][0];
      expect(call.data.status).toBe('failed');
      expect(call.data.role).toBe('user');
    });

    it('throws 409 IDEMPOTENCY_RESULT_UNAVAILABLE when replayed request messages are missing and reconciledAt is older than 30s grace period (CONV-02, QUOTA-05c)', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-stale-replay',
        ownerId: 'dev-user-001',
        provider: 'gateway',
        model: 'gpt-4o-mini',
        messages: [],
        checkpoints: [],
      });

      const llmService = (service as any).llmExecutionService;
      jest.spyOn(llmService, 'execute').mockResolvedValueOnce({
        success: true,
        content: 'Replay output',
        model: 'gpt-4o-mini',
        latencyMs: 150,
        requestId: 'req-stale-reconciled',
        isReplay: true,
      });

      mockPrisma.conversationMessage.findMany.mockResolvedValueOnce([]);

      mockPrisma.usageRecord.findUnique.mockResolvedValueOnce({
        id: 'ur-stale',
        idempotencyKey: 'req-stale-reconciled',
        status: 'reconciled',
        reconciledAt: new Date(Date.now() - 35_000),
      });

      await expect(
        service.sendMessage(
          'c-stale-replay',
          { content: 'Replayed input' },
          'dev-user-001',
          'req-stale-reconciled',
        ),
      ).rejects.toThrow('IDEMPOTENCY_RESULT_UNAVAILABLE');
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

  describe('contextBudget enforcement and sliding window (CONV-03)', () => {
    it('keeps all messages and reports zero truncation when dialogue is within budget', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-within-budget',
        title: 'Within Budget Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        contextBudget: 1000,
        status: 'active',
        messages: [
          { id: 'm-1', role: 'system', content: 'You are a helpful assistant.', sequenceNumber: 1, status: 'complete' },
          { id: 'm-2', role: 'user', content: 'Hello there', sequenceNumber: 2, status: 'complete' },
          { id: 'm-3', role: 'assistant', content: 'General Kenobi', sequenceNumber: 3, status: 'complete' },
        ],
        checkpoints: [],
      });

      const inspection = await service.inspectContext('c-within-budget', 'How are you?', 'dev-user-001');

      expect(inspection.withinBudget).toBe(true);
      expect(inspection.inputBudget).toBe(1000);
      expect(inspection.truncatedMessagesCount).toBe(0);
      expect(inspection.retainedMessagesCount).toBe(2);
      expect(inspection.assembledMessages.map((m) => m.content)).toEqual([
        'You are a helpful assistant.',
        'Hello there',
        'General Kenobi',
        'How are you?',
      ]);
    });

    it('drops oldest retained messages via sliding window when over budget, keeping system, checkpoint, and whole user turns (CONV-03b)', async () => {
      // System msg: ~8 tokens (32 chars)
      // Checkpoint: ~28 tokens
      // Retained m-3: 120 chars ~ 30 tokens (role: 'user')
      // Retained m-4: 120 chars ~ 30 tokens (role: 'assistant')
      // Retained m-5: 20 chars ~ 5 tokens (role: 'user')
      // Proposed new message: 16 chars ~ 4 tokens
      // Essential = 8 + 28 + 4 = 40 tokens
      // With contextBudget = 80 tokens:
      // Total without drop = 40 + 30 + 30 + 5 = 105 tokens > 80.
      // Dropping m-3 (30 tokens) leaves 75 tokens <= 80, but leaves m-4 (assistant) as first retained.
      // CONV-03b drops m-4 too so dialogue starts with m-5 (user) -> 45 tokens <= 80!
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-over-budget',
        title: 'Over Budget Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        contextBudget: 80,
        status: 'active',
        messages: [
          { id: 'm-1', role: 'system', content: 'You are a helpful test assistant', sequenceNumber: 1, status: 'complete' },
          { id: 'm-2', role: 'user', content: 'Compacted early turn', sequenceNumber: 2, status: 'complete' },
          { id: 'm-3', role: 'user', content: 'A'.repeat(120), sequenceNumber: 3, status: 'complete' },
          { id: 'm-4', role: 'assistant', content: 'B'.repeat(120), sequenceNumber: 4, status: 'complete' },
          { id: 'm-5', role: 'user', content: 'Short recent turn msg', sequenceNumber: 5, status: 'complete' },
        ],
        checkpoints: [
          {
            id: 'chk-1',
            conversationId: 'c-over-budget',
            summary: 'Compacted previous history facts.',
            retainedFacts: ['Fact Alpha'],
            compactedThroughSequence: 2,
            createdAt: new Date(),
          },
        ],
      });

      const inspection = await service.inspectContext('c-over-budget', 'New turn input', 'dev-user-001');

      expect(inspection.inputBudget).toBe(80);
      expect(inspection.withinBudget).toBe(true);
      // Both m-3 (user) and m-4 (assistant) dropped to avoid starting dialogue with orphaned reply
      expect(inspection.truncatedMessagesCount).toBe(2);
      expect(inspection.retainedMessagesCount).toBe(1); // m-5 kept

      // Verify system instruction is kept
      expect(inspection.assembledMessages[0].role).toBe('system');
      expect(inspection.assembledMessages[0].source).toBe('system-instruction');

      // Verify checkpoint summary is kept
      expect(inspection.assembledMessages[1].source).toBe('checkpoint-summary');

      // Verify surviving retained messages only include user m-5
      const retainedMessages = inspection.assembledMessages.filter((m) => m.source === 'retained-message');
      expect(retainedMessages.length).toBe(1);
      expect(retainedMessages[0].role).toBe('user');
      expect(retainedMessages[0].content).toBe('Short recent turn msg');

      // Verify new user message is kept
      const lastMsg = inspection.assembledMessages[inspection.assembledMessages.length - 1];
      expect(lastMsg.source).toBe('current-input');
      expect(lastMsg.content).toBe('New turn input');
    });

    it('caps effective contextBudget to model context limit (CONV-03a)', async () => {
      const gptPolicy = {
        contextWindow: 128_000,
        status: 'known' as const,
        defaultInputBudget: 8192,
        reservedOutputTokens: 1024,
      };

      // Known model: gpt-4o-mini (window 128,000, reservedOutput 1,024 -> maxInputBudget 126,976)
      const convKnown = {
        model: 'gpt-4o-mini',
        provider: 'openai',
        contextBudget: 1_048_576,
        messages: [{ role: 'system', content: 'sys', sequenceNumber: 1, status: 'complete' }],
      };
      const resultKnown = assembleConversationContext(convKnown, 'hi', gptPolicy);
      expect(resultKnown.requestedBudget).toBe(1_048_576);
      expect(resultKnown.inputBudget).toBe(126_976);

      // Unknown model: contextWindow null -> maxInputBudget = defaultInputBudget = 4,096
      const convUnknown = {
        model: 'some-unknown-model',
        provider: 'custom',
        contextBudget: 1_048_576,
        messages: [{ role: 'system', content: 'sys', sequenceNumber: 1, status: 'complete' }],
      };
      const resultUnknown = assembleConversationContext(convUnknown, 'hi');
      expect(resultUnknown.requestedBudget).toBe(1_048_576);
      expect(resultUnknown.inputBudget).toBe(4096);

      // Null contextBudget falls back to defaultInputBudget
      const convNull = {
        model: 'gpt-4o-mini',
        provider: 'openai',
        contextBudget: null,
        messages: [{ role: 'system', content: 'sys', sequenceNumber: 1, status: 'complete' }],
      };
      const resultNull = assembleConversationContext(convNull, 'hi', gptPolicy);
      expect(resultNull.requestedBudget).toBeNull();
      expect(resultNull.inputBudget).toBe(8192); // 50% of 128k capped at 8192
    });

    it('clamps stored contextBudget to model maximum on conversation creation (CONV-03a)', async () => {
      mockPrisma.$transaction.mockImplementationOnce(async (cb: any) => {
        return cb(mockPrisma);
      });
      mockPrisma.conversation.create.mockResolvedValueOnce({
        id: 'c-clamped',
        ownerId: 'dev-user-001',
        title: 'Clamped Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        contextBudget: 126_976,
        status: 'active',
        lastSequence: 0,
      });
      mockPrisma.conversation.findFirst.mockResolvedValueOnce({
        id: 'c-clamped',
        ownerId: 'dev-user-001',
        title: 'Clamped Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        contextBudget: 126_976,
        status: 'active',
        lastSequence: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [],
        checkpoints: [],
      });

      await service.create(
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          contextBudget: 1_048_576,
        },
        'dev-user-001',
      );

      expect(mockPrisma.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contextBudget: 126_976, // clamped from 1,048,576
          }),
        }),
      );
    });

    it('never starts the dialogue with an orphaned assistant reply across all budget ranges (CONV-03b)', () => {
      // 6 user/assistant turns = 12 dialogue messages:
      // seq 2 (user), seq 3 (assistant), seq 4 (user), seq 5 (assistant), ... seq 13 (assistant)
      // Each message is 40 chars ~ 10 tokens.
      const messages: any[] = [
        { id: 'm-1', role: 'system', content: 'S'.repeat(40), sequenceNumber: 1, status: 'complete' },
      ];
      for (let turn = 1; turn <= 6; turn++) {
        const userSeq = turn * 2;
        const asstSeq = userSeq + 1;
        messages.push({
          id: `m-${userSeq}`,
          role: 'user',
          content: `U${turn}: `.padEnd(40, 'x'),
          sequenceNumber: userSeq,
          status: 'complete',
        });
        messages.push({
          id: `m-${asstSeq}`,
          role: 'assistant',
          content: `A${turn}: `.padEnd(40, 'x'),
          sequenceNumber: asstSeq,
          status: 'complete',
        });
      }

      // Essential tokens = System (10) + New user input (10) = 20 tokens
      // Total tokens = 20 + 120 = 140 tokens
      const newMsg = 'N'.repeat(40); // 10 tokens

      const gptPolicy = {
        contextWindow: 128_000,
        status: 'known' as const,
        defaultInputBudget: 8192,
        reservedOutputTokens: 1024,
      };

      for (let budget = 20; budget <= 160; budget += 5) {
        const conv = {
          model: 'gpt-4o-mini',
          provider: 'openai',
          contextBudget: budget,
          messages,
        };

        const result = assembleConversationContext(conv, newMsg, gptPolicy);

        // Always fits within budget
        expect(result.totalEstimatedInputTokens).toBeLessThanOrEqual(result.inputBudget);

        // Surviving retained dialogue messages MUST begin with role 'user'
        const retained = result.assembledMessages.filter((m: any) => m.source === 'retained-message');
        if (retained.length > 0) {
          expect(retained[0].role).toBe('user');
        }

        // Truncated count accurately matches dropped retained messages
        expect(result.truncatedMessagesCount).toBe(12 - retained.length);
      }
    });

    it('fails fast with 409 CONTEXT_BUDGET_EXCEEDED without calling llmExecutionService when essential tokens alone exceed budget', async () => {
      // System prompt alone = 160 chars ~ 40 tokens
      // Proposed new message = 120 chars ~ 30 tokens
      // Essential = 70 tokens > budget of 50
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-impossible-budget',
        title: 'Impossible Budget Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        contextBudget: 50,
        status: 'active',
        messages: [
          { id: 'm-1', role: 'system', content: 'S'.repeat(160), sequenceNumber: 1, status: 'complete' },
          { id: 'm-2', role: 'user', content: 'Existing turn', sequenceNumber: 2, status: 'complete' },
        ],
        checkpoints: [],
      });

      const llmService = (service as any).llmExecutionService;
      const executeSpy = jest.spyOn(llmService, 'execute');

      // 1. inspectContext reports withinBudget: false and essentialTokensExceeded: true
      const inspection = await service.inspectContext('c-impossible-budget', 'U'.repeat(120), 'dev-user-001');
      expect(inspection.withinBudget).toBe(false);
      expect(inspection.essentialTokensExceeded).toBe(true);
      expect(inspection.truncatedMessagesCount).toBe(1);

      // 2. sendMessage throws 409 CONTEXT_BUDGET_EXCEEDED before executing LLM or reserving quota
      await expect(
        service.sendMessage(
          'c-impossible-budget',
          { content: 'U'.repeat(120) },
          'dev-user-001',
        ),
      ).rejects.toThrow('CONTEXT_BUDGET_EXCEEDED');

      // 3. Confirm provider / reserveUsage was NEVER called
      expect(executeSpy).not.toHaveBeenCalled();
    });
  });

  describe('CONV-04: Resumable Checkpoints (resume)', () => {
    const mockCheckpoints = [
      {
        id: 'chk-2',
        conversationId: 'c-resume-1',
        summary: 'Summary through turn 4',
        retainedFacts: ['fact-turn-4'],
        compactedThroughSequence: 4,
        createdAt: new Date('2026-10-26T01:00:00Z'),
      },
      {
        id: 'chk-1',
        conversationId: 'c-resume-1',
        summary: 'Summary through turn 2',
        retainedFacts: ['fact-turn-2'],
        compactedThroughSequence: 2,
        createdAt: new Date('2026-10-25T01:00:00Z'),
      },
    ];

    const mockMessages = [
      { id: 'm-1', role: 'system', content: 'System instruction', sequenceNumber: 1, status: 'complete' },
      { id: 'm-2', role: 'user', content: 'User turn 2', sequenceNumber: 2, status: 'complete' },
      { id: 'm-3', role: 'assistant', content: 'Assistant turn 3', sequenceNumber: 3, status: 'complete' },
      { id: 'm-4', role: 'user', content: 'User turn 4', sequenceNumber: 4, status: 'complete' },
      { id: 'm-5', role: 'assistant', content: 'Assistant turn 5', sequenceNumber: 5, status: 'complete' },
      { id: 'm-6', role: 'user', content: 'User turn 6', sequenceNumber: 6, status: 'complete' },
    ];

    it('persists activeCheckpointId and updates assembled context when resuming an older checkpoint', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-resume-1',
        ownerId: 'u-1',
        title: 'Resume Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        contextBudget: 4096,
        status: 'active',
        activeCheckpointId: 'chk-2',
        messages: mockMessages,
        checkpoints: mockCheckpoints,
      });

      const res = await service.resume('c-resume-1', 'chk-1', 'u-1');

      // 1. Confirms activeCheckpoint was set to chk-1
      expect(res.success).toBe(true);
      expect(res.activeCheckpoint?.id).toBe('chk-1');
      expect(res.activeCheckpoint?.compactedThroughSequence).toBe(2);

      // 2. Verified activeCheckpointId was persisted in PostgreSQL
      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c-resume-1' },
        data: {
          activeCheckpointId: 'chk-1',
          updatedAt: expect.any(Date),
        },
      });

      // 3. Assembled context uses chk-1 summary and retains messages after sequence 2 (seq 3, 4, 5, 6)
      const chkMsg = res.contextInspection.assembledMessages.find(
        (m) => m.source === 'checkpoint-summary',
      );
      expect(chkMsg?.content).toContain('Summary through turn 2');

      // Note: Sequence 3 is an assistant message whose preceding user message (seq 2) was summarized
      // into chk-1. Per CONV-03b whole-turn pruning, orphaned assistant messages are dropped so dialogue
      // starts cleanly with user turn 4.
      const retainedSeqs = res.contextInspection.assembledMessages
        .filter((m) => m.source === 'retained-message')
        .map((m) => m.sequenceNumber);
      expect(retainedSeqs).toEqual([4, 5, 6]);
      expect(res.originalMessagesRetained).toBe(6);
    });

    it('throws NotFoundException when resuming a non-existent checkpoint ID', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-resume-1',
        ownerId: 'u-1',
        title: 'Resume Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        messages: mockMessages,
        checkpoints: mockCheckpoints,
      });

      await expect(
        service.resume('c-resume-1', 'chk-non-existent', 'u-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when checkpoint belongs to a different conversation or user', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-resume-1',
        ownerId: 'u-1',
        title: 'Resume Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        messages: mockMessages,
        checkpoints: mockCheckpoints, // only contains chk-1 and chk-2
      });

      // chk-foreign-99 belongs to another conversation
      await expect(
        service.resume('c-resume-1', 'chk-foreign-99', 'u-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('CONV-05: Compaction Range Validation and Concurrency Serialization (applyCompaction)', () => {
    const mockMessages = [
      { id: 'm-1', role: 'system', content: 'System instruction', sequenceNumber: 1, status: 'complete' },
      { id: 'm-2', role: 'user', content: 'Turn 2', sequenceNumber: 2, status: 'complete' },
      { id: 'm-3', role: 'assistant', content: 'Turn 3', sequenceNumber: 3, status: 'complete' },
      { id: 'm-4', role: 'user', content: 'Turn 4', sequenceNumber: 4, status: 'complete' },
      { id: 'm-5', role: 'assistant', content: 'Turn 5', sequenceNumber: 5, status: 'complete' },
      { id: 'm-6', role: 'user', content: 'Turn 6', sequenceNumber: 6, status: 'complete' },
    ];

    it('rejects with 400 and INVALID_COMPACTION_RANGE when compactedThroughSequence <= activeCheckpoint.compactedThroughSequence', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-comp-1',
        ownerId: 'u-1',
        title: 'Compaction Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        activeCheckpointId: 'chk-1',
        messages: mockMessages,
        checkpoints: [
          {
            id: 'chk-1',
            conversationId: 'c-comp-1',
            summary: 'Checkpoint 1',
            compactedThroughSequence: 3,
            createdAt: new Date(),
          },
        ],
      });

      try {
        await service.applyCompaction(
          'c-comp-1',
          { summary: 'New summary', compactedThroughSequence: 3, retainedFacts: ['fact-1'] },
          'u-1',
        );
        fail('Expected BadRequestException to be thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(BadRequestException);
        const resp = err.getResponse();
        expect(resp.code).toBe('INVALID_COMPACTION_RANGE');
      }
    });

    it('rejects with 400 and INVALID_COMPACTION_RANGE when compactedThroughSequence >= maxSeq (latest message must remain uncompacted)', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-comp-1',
        ownerId: 'u-1',
        title: 'Compaction Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        messages: mockMessages, // maxSeq is 6
        checkpoints: [],
      });

      try {
        await service.applyCompaction(
          'c-comp-1',
          { summary: 'New summary', compactedThroughSequence: 6, retainedFacts: ['fact-1'] },
          'u-1',
        );
        fail('Expected BadRequestException to be thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(BadRequestException);
        const resp = err.getResponse();
        expect(resp.code).toBe('INVALID_COMPACTION_RANGE');
      }
    });

    it('locks conversation row with FOR UPDATE, creates checkpoint, and sets activeCheckpointId in one transaction', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'c-comp-1',
        ownerId: 'u-1',
        title: 'Compaction Conv',
        provider: 'openai',
        model: 'gpt-4o-mini',
        contextBudget: 4096,
        status: 'active',
        messages: mockMessages,
        checkpoints: [],
      });

      mockPrisma.conversationCheckpoint.create.mockResolvedValue({
        id: 'chk-created-1',
        conversationId: 'c-comp-1',
        summary: 'Newly created compaction checkpoint',
        retainedFacts: ['fact-a'],
        compactedThroughSequence: 4,
        createdAt: new Date(),
      });

      const res = await service.applyCompaction(
        'c-comp-1',
        {
          summary: 'Newly created compaction checkpoint',
          compactedThroughSequence: 4,
          retainedFacts: ['fact-a'],
        },
        'u-1',
      );

      expect(res.success).toBe(true);
      expect(res.checkpoint.id).toBe('chk-created-1');
      expect(res.checkpoint.compactedThroughSequence).toBe(4);

      // Verify row lock was issued via $queryRaw
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();

      // Verify activeCheckpointId was set in the transaction
      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c-comp-1' },
        data: {
          activeCheckpointId: 'chk-created-1',
          updatedAt: expect.any(Date),
        },
      });
    });
  });
});
