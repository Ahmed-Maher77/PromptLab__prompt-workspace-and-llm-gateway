import { Test, TestingModule } from '@nestjs/testing';
import { ExperimentsService } from './experiments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { PromptsService } from '../prompts/prompts.service';
import { NotFoundException } from '@nestjs/common';

describe('ExperimentsService', () => {
  let service: ExperimentsService;
  let mockPrisma: any;
  let mockProviders: any;
  let mockPrompts: any;

  beforeEach(async () => {
    mockPrisma = {
      experiment: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      promptVersion: {
        findUnique: jest.fn(),
      },
    };

    mockProviders = {
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExperimentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProvidersService, useValue: mockProviders },
        { provide: PromptsService, useValue: mockPrompts },
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
      });

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
      });

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

      const result = await service.findById('exp-saved');
      expect(result.id).toBe('exp-saved');
      expect(result.commonInput).toEqual({ query: 'hello' });
      expect(result.runs.length).toBe(1);
    });

    it('should throw NotFoundException if experiment does not exist', async () => {
      mockPrisma.experiment.findUnique.mockResolvedValueOnce(null);
      let error: unknown;
      try {
        await service.findById('missing');
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
      });

      expect(updated.rating).toBe(5);
      expect(updated.slot).toBe('A');
      expect(mockPrisma.experiment.update).toHaveBeenCalled();
    });
  });
});
