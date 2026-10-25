import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { Prisma } from '@prisma/client';

describe('PromptsService', () => {
  let service: PromptsService;
  let mockPrisma: any;
  let mockProviders: any;

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
      user: {
        upsert: jest.fn().mockResolvedValue({ id: 'dev-user-001', email: 'developer@promptlab.local' }),
      },
      prompt: {
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      promptVersion: {
        create: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    mockProviders = {
      estimateTokens: jest.fn((text: string) => Math.ceil(text.length / 4)),
      executeChatCompletion: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProvidersService, useValue: mockProviders },
      ],
    }).compile();

    service = module.get<PromptsService>(PromptsService);
  });

  describe('Variable Extraction & Resolution', () => {
    it('should extract variables accurately from template', () => {
      const template = 'Translate {{text}} to {{target_language}} with tone {{tone}}.';
      const variables = service.extractVariables(template);
      expect(variables).toEqual(['text', 'target_language', 'tone']);
    });

    it('should resolve variables while strictly preserving whitespace and newlines', () => {
      const template = `Line 1:   indented\nLine 2: {{greeting}}!\n\nLine 4: {{name}}\n   Trailing whitespace   `;
      const result = service.resolveTemplate({
        templateBody: template,
        variables: {
          greeting: 'Hello',
          name: 'Developer',
        },
      });

      expect(result.resolvedPrompt).toBe(
        `Line 1:   indented\nLine 2: Hello!\n\nLine 4: Developer\n   Trailing whitespace   `,
      );
      expect(result.missingVariables).toEqual([]);
      expect(result.detectedVariables).toEqual(['greeting', 'name']);
    });

    it('should identify missing variables when not provided or empty', () => {
      const template = 'Hello {{first_name}} {{last_name}}, your role is {{role}}.';
      const result = service.resolveTemplate({
        templateBody: template,
        variables: {
          first_name: 'Alice',
          role: '',
        },
      });

      expect(result.missingVariables).toEqual(['last_name', 'role']);
    });

    it('should append few-shot examples when provided', () => {
      const template = 'Classify the sentiment: {{text}}';
      const result = service.resolveTemplate({
        templateBody: template,
        variables: { text: 'I love this tool!' },
        examples: [
          { input: 'Great product', output: 'Positive' },
          { input: 'Terrible lag', output: 'Negative' },
        ],
      });

      expect(result.resolvedPrompt).toContain('### Examples:');
      expect(result.resolvedPrompt).toContain('Input: Great product\nOutput: Positive');
    });
  });

  describe('Prompt Creation & Versioning', () => {
    it('should create prompt and version 1', async () => {
      const mockCreated = {
        id: 'p-1',
        name: 'Test Prompt',
        description: 'Test Description',
        techniqueMetadata: { techniques: ['zero-shot'] },
        createdAt: new Date(),
        updatedAt: new Date(),
        owner: { id: 'dev-user-001', displayName: 'Developer', email: 'developer@promptlab.local' },
        versions: [
          {
            id: 'v-1',
            versionNumber: 1,
            templateBody: 'Test template {{input}}',
            variables: [{ name: 'input', required: true }],
            examples: [],
            outputSchema: null,
            modelDefaults: { model: 'gpt-4o-mini' },
            createdAt: new Date(),
            createdBy: 'dev-user-001',
          },
        ],
      };

      mockPrisma.prompt.create.mockResolvedValueOnce(mockCreated);
      mockPrisma.prompt.findFirst.mockResolvedValueOnce(mockCreated);

      const result = await service.create({
        name: 'Test Prompt',
        description: 'Test Description',
        techniques: ['zero-shot'],
        templateBody: 'Test template {{input}}',
      }, 'dev-user-001');

      expect(result.id).toBe('p-1');
      expect(result.versions.length).toBe(1);
      expect(result.versions[0].versionNumber).toBe(1);
    });

    it('should create next version (v2) incrementing versionNumber immutably', async () => {
      const existingPrompt = {
        id: 'p-1',
        name: 'Test Prompt',
        description: 'Test Description',
        techniqueMetadata: { techniques: ['zero-shot'] },
        versions: [{ versionNumber: 1 }],
      };

      const updatedPrompt = {
        ...existingPrompt,
        createdAt: new Date(),
        updatedAt: new Date(),
        owner: { id: 'dev-user-001', displayName: 'Developer', email: 'developer@promptlab.local' },
        versions: [
          {
            id: 'v-2',
            versionNumber: 2,
            templateBody: 'Updated template {{input}}',
            variables: [{ name: 'input', required: true }],
            examples: [],
            outputSchema: null,
            modelDefaults: { model: 'gpt-4o-mini' },
            createdAt: new Date(),
            createdBy: 'dev-user-001',
          },
          {
            id: 'v-1',
            versionNumber: 1,
            templateBody: 'Old template {{input}}',
            variables: [{ name: 'input', required: true }],
            examples: [],
            outputSchema: null,
            modelDefaults: { model: 'gpt-4o-mini' },
            createdAt: new Date(),
            createdBy: 'dev-user-001',
          },
        ],
      };

      mockPrisma.prompt.findFirst
        .mockResolvedValueOnce(existingPrompt)
        .mockResolvedValueOnce(updatedPrompt);

      mockPrisma.promptVersion.create.mockResolvedValueOnce({
        id: 'v-2',
        promptId: 'p-1',
        versionNumber: 2,
      });

      mockPrisma.prompt.update.mockResolvedValueOnce(updatedPrompt);

      const result = await service.createVersion('p-1', {
        templateBody: 'Updated template {{input}}',
      }, 'dev-user-001');

      expect(result.versions.length).toBe(2);
      expect(result.versions[0].versionNumber).toBe(2);
      expect(result.versions[1].versionNumber).toBe(1);
      // Historical version 1 remains intact and unmodified
      expect(result.versions[1].templateBody).toBe('Old template {{input}}');
    });

    it('should throw ConflictException if concurrent version creation hits unique constraint (P2002)', async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on promptId, versionNumber', {
        code: 'P2002',
        clientVersion: '6.4.1',
      });
      mockPrisma.$transaction.mockRejectedValueOnce(p2002Error);

      let error: unknown;
      try {
        await service.createVersion('p-1', {
          templateBody: 'Concurrent template',
        }, 'dev-user-001');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ConflictException);
    });

    it('should throw NotFoundException if prompt does not exist', async () => {
      mockPrisma.prompt.findFirst.mockResolvedValueOnce(null);
      let error: unknown;
      try {
        await service.findById('non-existent', 'dev-user-001');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(NotFoundException);
    });

    it('should scope findAll strictly by caller ownerId', async () => {
      mockPrisma.prompt.findMany.mockResolvedValueOnce([]);
      await service.findAll('user-alice', { search: 'test' });
      expect(mockPrisma.prompt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ownerId: 'user-alice',
          }),
        }),
      );
    });

    it('should reject findById when prompt is owned by another user', async () => {
      mockPrisma.prompt.findFirst.mockResolvedValueOnce(null);
      await expect(service.findById('prompt-bob', 'user-alice')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.prompt.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prompt-bob', ownerId: 'user-alice' },
        }),
      );
    });

    it('should reject createVersion when prompt is owned by another user', async () => {
      mockPrisma.prompt.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.createVersion('prompt-bob', { templateBody: 'Malicious modification' }, 'user-alice'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Playground Execution', () => {
    it('should throw BadRequestException if required variables are missing', async () => {
      let error: unknown;
      try {
        await service.runPlayground({
          templateBody: 'Translate {{text}} to {{target_language}}',
          variables: { text: 'Hello' }, // target_language missing
          model: 'gpt-4o-mini',
        }, 'dev-user-001');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(BadRequestException);
    });

    it('should resolve variables and call providersService when inputs are valid', async () => {
      mockProviders.executeChatCompletion.mockResolvedValueOnce({
        success: true,
        model: 'gpt-4o-mini',
        content: 'Bonjour',
        latencyMs: 142,
        usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12, source: 'provider-reported' },
      });

      const result = await service.runPlayground({
        templateBody: 'Translate {{text}} to {{target_language}}',
        variables: { text: 'Hello', target_language: 'French' },
        model: 'gpt-4o-mini',
      }, 'dev-user-001');

      expect(result.success).toBe(true);
      expect(result.resolvedPrompt).toBe('Translate Hello to French');
      expect(result.content).toBe('Bonjour');
      expect(result.latencyMs).toBe(142);
      expect(result.usage?.source).toBe('provider-reported');
    });
  });
});
