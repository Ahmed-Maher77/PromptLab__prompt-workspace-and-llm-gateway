import { Test, TestingModule } from '@nestjs/testing';
import { ExperimentsService } from './experiments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { PromptsService } from '../prompts/prompts.service';
import { UsageService } from '../usage/usage.service';
import { ObservabilityService } from '../observability/observability.service';
import { LlmExecutionService } from '../llm/llm-execution.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('ExperimentsService', () => {
  let service: ExperimentsService;
  let mockPrisma: any;
  let mockProviders: any;
  let mockPrompts: any;
  let mockUsage: any;

  beforeEach(async () => {
    mockPrisma = {
      experiment: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      promptVersion: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    mockPrisma.experiment.findFirst = mockPrisma.experiment.findUnique;
    mockPrisma.promptVersion.findFirst = mockPrisma.promptVersion.findUnique;


    mockProviders = {
      estimateTokens: jest.fn((text: string) => Math.max(1, Math.ceil((text || '').length / 4))),
      executeChatCompletion: jest.fn(),
    };

    mockPrompts = {
      resolveTemplate: jest.fn((dto) => {
        let text = dto.templateBody;
        for (const [k, v] of Object.entries(dto.variables || {})) {
          text = text.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v));
        }
        return { resolvedPrompt: text };
      }),
    };

    mockUsage = {
      reserveUsage: jest.fn().mockResolvedValue({ success: true, remainingTokens: 1000 }),
      reconcileUsage: jest.fn().mockResolvedValue({ success: true }),
    };

    const mockObservability = {
      startTrace: jest.fn().mockReturnValue({
        traceId: 'trace-test',
        startSpan: jest.fn().mockReturnValue({ id: 'span-1', end: jest.fn() }),
        complete: jest.fn(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExperimentsService,
        LlmExecutionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProvidersService, useValue: mockProviders },
        { provide: PromptsService, useValue: mockPrompts },
        { provide: UsageService, useValue: mockUsage },
        { provide: ObservabilityService, useValue: mockObservability },
      ],
    }).compile();

    service = module.get<ExperimentsService>(ExperimentsService);
  });

  describe('runComparison', () => {
    it('should execute both slots with shared inputs and return side-by-side results', async () => {
      mockPrisma.promptVersion.findUnique
        .mockResolvedValueOnce({
          id: 'pv-1',
          versionNumber: 1,
          templateBody: 'Summarize concisely: {{text}}',
          prompt: { id: 'p-1', name: 'Summarizer v1' },
        })
        .mockResolvedValueOnce({
          id: 'pv-2',
          versionNumber: 2,
          templateBody: 'Provide a 3-bullet summary: {{text}}',
          prompt: { id: 'p-1', name: 'Summarizer v2' },
        });

      mockProviders.executeChatCompletion
        .mockResolvedValueOnce({
          success: true,
          model: 'gpt-4o-mini',
          content: 'This is a concise summary.',
          latencyMs: 150,
          usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30, source: 'provider-reported' },
        })
        .mockResolvedValueOnce({
          success: true,
          model: 'gpt-4o-mini',
          content: '- Bullet 1\n- Bullet 2\n- Bullet 3',
          latencyMs: 210,
          usage: { promptTokens: 25, completionTokens: 18, totalTokens: 43, source: 'provider-reported' },
        });

      mockPrisma.experiment.create.mockResolvedValueOnce({
        id: 'exp-1',
        name: 'Summary comparison',
        createdAt: new Date(),
        runs: [],
      });

      const result = await service.runComparison({
        name: 'Summary comparison',
        commonInput: { text: 'PromptLab is a developer platform for LLM workflows.' },
        slotA: {
          promptVersionId: 'pv-1',
          provider: 'openai',
          model: 'gpt-4o-mini',
          temperature: 0.3,
        },
        slotB: {
          promptVersionId: 'pv-2',
          provider: 'openai',
          model: 'gpt-4o-mini',
          temperature: 0.7,
        },
        evaluationCriteria: [
          { id: 'c-1', name: 'Mentions PromptLab', type: 'contains_text', expectedValue: 'PromptLab' },
        ],
      }, 'dev-user-001');

      expect(result.experimentId).toBe('exp-1');
      expect(result.slotA.status).toBe('completed');
      expect(result.slotA.output).toBe('This is a concise summary.');
      expect(result.slotA.latencyMs).toBe(150);
      expect(result.slotA.tokenUsageSource).toBe('provider-reported');
      expect(result.slotA.estimatedCost).toBeGreaterThan(0);

      expect(result.slotB.status).toBe('completed');
      expect(result.slotB.output).toContain('Bullet 1');
      expect(result.slotB.latencyMs).toBe(210);

      expect(mockPrisma.experiment.create).toHaveBeenCalled();
    });

    it('should handle partial failure: slot A fails while slot B succeeds', async () => {
      mockPrisma.promptVersion.findUnique
        .mockResolvedValueOnce({
          id: 'pv-1',
          templateBody: 'Template A: {{input}}',
          prompt: { id: 'p-1', name: 'Prompt A' },
        })
        .mockResolvedValueOnce({
          id: 'pv-2',
          templateBody: 'Template B: {{input}}',
          prompt: { id: 'p-2', name: 'Prompt B' },
        });

      // Slot A fails with provider_auth_error, Slot B succeeds
      mockProviders.executeChatCompletion
        .mockResolvedValueOnce({
          success: false,
          model: 'gpt-4o-mini',
          errorType: 'provider_auth_error',
          errorMessage: 'Invalid API key for OpenAI',
          configurationHint: 'Configure OPENAI_API_KEY',
          latencyMs: 40,
        })
        .mockResolvedValueOnce({
          success: true,
          model: 'claude-3-5-sonnet',
          content: 'Successful output from Claude',
          latencyMs: 380,
          usage: { promptTokens: 30, completionTokens: 12, totalTokens: 42, source: 'provider-reported' },
        });

      mockPrisma.experiment.create.mockResolvedValueOnce({
        id: 'exp-partial',
        name: 'Partial failure test',
        createdAt: new Date(),
        runs: [],
      });

      const result = await service.runComparison({
        name: 'Partial failure test',
        commonInput: { input: 'Test input' },
        slotA: {
          promptVersionId: 'pv-1',
          provider: 'openai',
          model: 'gpt-4o-mini',
        },
        slotB: {
          promptVersionId: 'pv-2',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
        },
      }, 'dev-user-001');

      // Slot A is marked failed with error details
      expect(result.slotA.status).toBe('failed');
      expect(result.slotA.output).toBeNull();
      expect(result.slotA.errorCode).toBe('provider_auth_error');
      expect(result.slotA.errorMessage).toContain('Invalid API key');

      // Slot B result is completely available
      expect(result.slotB.status).toBe('completed');
      expect(result.slotB.output).toBe('Successful output from Claude');
      expect(result.slotB.latencyMs).toBe(380);
      expect(result.slotB.tokenUsageSource).toBe('provider-reported');
    });

    it('should pass caller userId to reserveUsage for both comparison slots (SEC-01d)', async () => {
      mockPrisma.promptVersion.findUnique.mockResolvedValue({
        id: 'pv-1',
        versionNumber: 1,
        templateBody: 'Template: {{input}}',
        prompt: { id: 'p-1', name: 'Prompt A' },
      });

      mockProviders.executeChatCompletion.mockResolvedValue({
        success: true,
        model: 'gpt-4o-mini',
        content: 'Slot output',
        latencyMs: 100,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, source: 'provider-reported' },
      });

      mockPrisma.experiment.create.mockResolvedValueOnce({
        id: 'exp-quota-user',
        name: 'Quota user test',
        createdAt: new Date(),
        runs: [],
      });

      await service.runComparison({
        name: 'Quota user test',
        commonInput: { input: 'test' },
        slotA: {
          promptVersionId: 'pv-1',
          provider: 'openai',
          model: 'gpt-4o-mini',
        },
        slotB: {
          promptVersionId: 'pv-1',
          provider: 'openai',
          model: 'gpt-4o-mini',
        },
      }, 'caller-user-456');

      expect(mockUsage.reserveUsage).toHaveBeenCalledTimes(2);
      expect(mockUsage.reserveUsage).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ userId: 'caller-user-456' }),
      );
      expect(mockUsage.reserveUsage).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ userId: 'caller-user-456' }),
      );
    });

    it('should throw NotFoundException (404) if promptVersionId does not exist and NOT call LLM or reserveUsage (EXP-01)', async () => {
      mockPrisma.promptVersion.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.runComparison({
          name: 'Invalid version test',
          commonInput: { input: 'test' },
          slotA: {
            promptVersionId: 'non-existent-version',
            provider: 'openai',
            model: 'gpt-4o-mini',
          },
          slotB: {
            templateBody: 'Valid template {{input}}',
            provider: 'openai',
            model: 'gpt-4o-mini',
          },
        }, 'user-123'),
      ).rejects.toThrow(NotFoundException);

      // Verify no LLM calls and no usage reservations were made
      expect(mockProviders.executeChatCompletion).not.toHaveBeenCalled();
      expect(mockUsage.reserveUsage).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException (404) if user B uses user A's promptVersionId, with zero LLM and quota calls (EXP-01b)", async () => {
      mockPrisma.promptVersion.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.runComparison({
          name: 'IDOR attempt test',
          commonInput: { input: 'test' },
          slotA: {
            promptVersionId: 'pv-user-a',
            provider: 'openai',
            model: 'gpt-4o-mini',
          },
          slotB: {
            templateBody: 'Valid template {{input}}',
            provider: 'openai',
            model: 'gpt-4o-mini',
          },
        }, 'user-b'),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.promptVersion.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'pv-user-a',
          prompt: { ownerId: 'user-b' },
        },
        include: { prompt: true },
      });
      expect(mockProviders.executeChatCompletion).not.toHaveBeenCalled();
      expect(mockUsage.reserveUsage).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException (400) if slot provides neither promptVersionId nor non-empty templateBody (EXP-01)', async () => {
      await expect(
        service.runComparison({
          name: 'Missing template test',
          commonInput: { input: 'test' },
          slotA: {
            templateBody: '   ',
            provider: 'openai',
            model: 'gpt-4o-mini',
          },
          slotB: {
            templateBody: 'Valid template {{input}}',
            provider: 'openai',
            model: 'gpt-4o-mini',
          },
        }, 'user-123'),
      ).rejects.toThrow(BadRequestException);

      expect(mockProviders.executeChatCompletion).not.toHaveBeenCalled();
      expect(mockUsage.reserveUsage).not.toHaveBeenCalled();
    });
  });

  describe('Evaluation Criteria', () => {
    it('should accurately evaluate contains_text criterion', () => {
      const criteria = [
        { id: 'c-1', name: 'Contains Keyword', type: 'contains_text' as const, expectedValue: 'success' },
      ];

      const passResult = service.evaluateCriteria('The operation was a great Success!', criteria);
      expect(passResult[0].passed).toBe(true);

      const failResult = service.evaluateCriteria('Operation failed', criteria);
      expect(failResult[0].passed).toBe(false);
    });

    it('should accurately evaluate json_validity criterion', () => {
      const criteria = [
        { id: 'c-2', name: 'Valid JSON', type: 'json_validity' as const },
      ];

      const validJson = service.evaluateCriteria('Here is output: {"status": "ok", "code": 200}', criteria);
      expect(validJson[0].passed).toBe(true);

      const invalidJson = service.evaluateCriteria('{"broken: true', criteria);
      expect(invalidJson[0].passed).toBe(false);
    });

    it('should accurately evaluate max_length criterion', () => {
      const criteria = [
        { id: 'c-3', name: 'Max 10 Chars', type: 'max_length' as const, expectedValue: '10' },
      ];

      const shortOutput = service.evaluateCriteria('123456789', criteria);
      expect(shortOutput[0].passed).toBe(true);

      const longOutput = service.evaluateCriteria('123456789012345', criteria);
      expect(longOutput[0].passed).toBe(false);
    });

    it('should evaluate regex criterion matching and handle invalid regex safely', () => {
      const validRegexCriteria = [
        { id: 'c-4', name: 'Has Order ID', type: 'regex' as const, expectedValue: 'order\\s*#?\\d+' },
      ];

      const matchOutput = service.evaluateCriteria('Your Order #4567 is being processed', validRegexCriteria);
      expect(matchOutput[0].passed).toBe(true);
      expect(matchOutput[0].notes).toBe('Matches regex pattern');

      const nonMatchOutput = service.evaluateCriteria('Hello world', validRegexCriteria);
      expect(nonMatchOutput[0].passed).toBe(false);
      expect(nonMatchOutput[0].notes).toBe('Did not match regex pattern');

      // Invalid regex pattern should fail safely and not throw
      const invalidRegexCriteria = [
        { id: 'c-5', name: 'Broken Regex', type: 'regex' as const, expectedValue: '[a-z' },
      ];
      const invalidOutput = service.evaluateCriteria('Any content', invalidRegexCriteria);
      expect(invalidOutput[0].passed).toBe(false);
      expect(invalidOutput[0].notes).toBe('Invalid regular expression');
    });

    it('SEC-02: should evaluate ReDoS patterns safely in linear time without event loop freeze', () => {
      // Warm up module/JIT
      service.evaluateCriteria('warmup', [{ id: 'w', name: 'w', type: 'regex' as const, expectedValue: 'warmup' }]);

      const tenKbOutput = 'a'.repeat(10000) + '!';
      const redosCriteria = [
        { id: 'c-redos-1', name: 'Alternation overlap 1', type: 'regex' as const, expectedValue: '(a|aa)+$' },
        { id: 'c-redos-2', name: 'Alternation overlap 2', type: 'regex' as const, expectedValue: '(\\w|\\d)+$' },
      ];

      const start = Date.now();
      const results = service.evaluateCriteria(tenKbOutput, redosCriteria);
      const elapsed = Date.now() - start;

      expect(results.length).toBe(2);
      expect(results[0].passed).toBe(false);
      expect(results[1].passed).toBe(false);
      expect(elapsed).toBeLessThan(1000);
    });

    it('SEC-02: should handle empty, broken, and unsupported patterns gracefully per-criterion without throwing', () => {
      const criteria = [
        { id: 'c-empty', name: 'Empty', type: 'regex' as const, expectedValue: '' },
        { id: 'c-broken', name: 'Broken', type: 'regex' as const, expectedValue: '[a-z' },
        { id: 'c-toolong', name: 'Too Long', type: 'regex' as const, expectedValue: 'x'.repeat(260) },
      ];

      const results = service.evaluateCriteria('Sample text 123', criteria);
      expect(results.length).toBe(3);
      expect(results[0].passed).toBe(false);
      expect(results[0].notes).toBe('Regex pattern is empty');
      expect(results[1].passed).toBe(false);
      expect(results[1].notes).toContain('Invalid regular expression');
      expect(results[2].passed).toBe(false);
      expect(results[2].notes).toBe('Regex pattern exceeds maximum allowed length of 256 characters');
    });

    it('SEC-02: should pre-compile criteria once when preparing comparison', () => {
      const criteria = [
        { id: 'c-1', name: 'Regex', type: 'regex' as const, expectedValue: 'hello' },
        { id: 'c-2', name: 'Text', type: 'contains_text' as const, expectedValue: 'world' },
      ];

      const prepared = service.prepareCriteria(criteria);
      expect(prepared.length).toBe(2);
      expect(prepared[0].compiledRegex).toBeDefined();
      expect(prepared[0].compiledRegex?.test).toBeDefined();
      expect(prepared[1].compiledRegex).toBeUndefined();
    });
  });

  describe('findById & updateRating', () => {
    it('should reopen saved experiment by ID', async () => {
      mockPrisma.experiment.findUnique.mockResolvedValueOnce({
        id: 'exp-saved',
        name: 'Saved comparison',
        commonInput: '{"query": "hello"}',
        settings: { evaluationCriteria: [] },
        createdAt: new Date(),
        runs: [
          {
            id: 'r-1',
            slot: 'A',
            provider: 'openai',
            model: 'gpt-4o-mini',
            output: 'Hi there',
            status: 'completed',
            latencyMs: 120,
            inputTokens: 10,
            outputTokens: 5,
            tokenUsageSource: 'provider-reported',
          },
        ],
      });

      const result = await service.findById('exp-saved', 'dev-user-001');
      expect(result.id).toBe('exp-saved');
      expect(result.commonInput).toEqual({ query: 'hello' });
      expect(result.runs.length).toBe(1);
    });

    it('should throw NotFoundException if experiment does not exist', async () => {
      mockPrisma.experiment.findUnique.mockResolvedValueOnce(null);
      let error: unknown;
      try {
        await service.findById('missing', 'dev-user-001');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(NotFoundException);
    });

    it('should update manual rating and feedback notes for a slot', async () => {
      mockPrisma.experiment.findUnique.mockResolvedValueOnce({
        id: 'exp-1',
        settings: { evaluations: {} },
      });

      mockPrisma.experiment.update.mockResolvedValueOnce({
        id: 'exp-1',
        settings: {
          evaluations: {
            A: { manualRating: 5, manualNotes: 'Excellent formatting' },
          },
        },
      });

      const updated = await service.updateRating('exp-1', {
        slot: 'A',
        rating: 5,
        notes: 'Excellent formatting',
      }, 'dev-user-001');

      expect(updated.rating).toBe(5);
      expect(updated.slot).toBe('A');
      expect(mockPrisma.experiment.update).toHaveBeenCalled();
    });
  });
});
