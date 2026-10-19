import { Injectable, NotFoundException, BadRequestException, ConflictException, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService, CompletionResult } from '../providers/providers.service';
import { UsageService } from '../usage/usage.service';
import { CreatePromptDto, PromptVariableDto, FewShotExampleDto } from './dto/create-prompt.dto';
import { CreateVersionDto } from './dto/create-version.dto';
import { PreviewPromptDto, RunPlaygroundDto } from './dto/run-prompt.dto';
import { Prisma } from '@prisma/client';

export interface PromptSummary {
  id: string;
  name: string;
  description: string | null;
  techniques: string[];
  versionCount: number;
  latestVersionNumber: number;
  latestTemplateBody: string;
  createdAt: Date;
  updatedAt: Date;
  owner: {
    id: string;
    displayName: string;
    email: string;
  };
}

export interface PromptDetail {
  id: string;
  name: string;
  description: string | null;
  techniques: string[];
  createdAt: Date;
  updatedAt: Date;
  owner: {
    id: string;
    displayName: string;
    email: string;
  };
  versions: Array<{
    id: string;
    versionNumber: number;
    templateBody: string;
    variables: PromptVariableDto[];
    examples: FewShotExampleDto[];
    outputSchema: Record<string, unknown> | null;
    modelDefaults: { model?: string; temperature?: number; maxTokens?: number };
    createdAt: Date;
    createdBy: string;
  }>;
}

export interface ResolvedPreview {
  resolvedPrompt: string;
  detectedVariables: string[];
  missingVariables: string[];
  estimatedTokens: number;
  characterCount: number;
}

export interface PlaygroundRunResult extends CompletionResult {
  resolvedPrompt: string;
}

@Injectable()
export class PromptsService implements OnModuleInit {
  private readonly logger = new Logger(PromptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providersService: ProvidersService,
    @Optional() private readonly usageService?: UsageService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultUserAndSeeds();
  }

  /**
   * Ensures default user and seed templates exist on startup for immediate out-of-the-box readiness.
   */
  async ensureDefaultUserAndSeeds() {
    try {
      const defaultUser = await this.prisma.user.upsert({
        where: { id: 'dev-user-001' },
        update: {},
        create: {
          id: 'dev-user-001',
          email: 'developer@promptlab.local',
          displayName: 'Developer',
          role: 'admin',
        },
      });

      const existingCount = await this.prisma.prompt.count();
      if (existingCount === 0) {
        this.logger.log('Seeding initial reference prompt templates for Phase 1...');
        await this.seedReferencePrompts(defaultUser.id);
      }
    } catch (err) {
      this.logger.warn(`Could not verify default user or seed prompts: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async seedReferencePrompts(ownerId: string) {
    // 1. Customer Support Routing (zero-shot, structured-output)
    await this.create(
      {
        name: 'Customer Support Inquiry Classifier',
        description: 'Categorizes incoming customer messages with sentiment, urgency, and routing target.',
        techniques: ['zero-shot', 'structured-output'],
        templateBody: `You are an intelligent customer support routing assistant.\nAnalyze the customer inquiry below and classify it into one of the designated categories.\n\nCustomer Inquiry:\n"""\n{{customer_inquiry}}\n"""\n\nFormat your response as a valid JSON object matching the following structure:\n{\n  "category": "Billing" | "Technical Support" | "Account Access" | "Sales Inquiry" | "General Feedback",\n  "urgency": "Low" | "Medium" | "High",\n  "sentiment": "Positive" | "Neutral" | "Negative",\n  "recommendedAction": "short explanation of next step"\n}`,
        variables: [
          {
            name: 'customer_inquiry',
            description: 'The raw text message received from the customer',
            required: true,
            defaultValue: 'I was charged twice for my subscription this month and cannot access my team workspace. Please refund immediately!',
          },
        ],
        modelDefaults: {
          model: 'gpt-4o-mini',
          temperature: 0.2,
          maxTokens: 512,
        },
      },
      ownerId,
    );

    // 2. SQL Generator (few-shot, RTF)
    await this.create(
      {
        name: 'PostgreSQL Query Generator',
        description: 'Transforms natural language analytical queries into optimized PostgreSQL statements.',
        techniques: ['few-shot', 'RTF'],
        templateBody: `Role: Senior PostgreSQL Database Engineer\nTask: Translate natural language requests into performant, clean SQL queries adhering to PostgreSQL syntax.\nFormat: Output only the SQL query enclosed in a single \`\`\`sql code block, without commentary.\n\nDatabase Schema:\nTable "users" (id UUID, email VARCHAR, role VARCHAR, created_at TIMESTAMP)\nTable "prompts" (id UUID, owner_id UUID, name VARCHAR, created_at TIMESTAMP)\nTable "usage_records" (id UUID, user_id UUID, total_tokens INT, created_at TIMESTAMP)\n\nUser Request:\n{{user_request}}`,
        variables: [
          {
            name: 'user_request',
            description: 'Plain English description of the desired database query',
            required: true,
            defaultValue: 'Find the top 5 users who consumed the most tokens during the last 30 days',
          },
        ],
        examples: [
          {
            input: 'Count how many users registered this month',
            output: `\`\`\`sql\nSELECT COUNT(*) AS total_users\nFROM users\nWHERE created_at >= date_trunc('month', CURRENT_TIMESTAMP);\n\`\`\``,
          },
          {
            input: 'List all prompts created by user dev-user-001 ordered newest first',
            output: `\`\`\`sql\nSELECT id, name, created_at\nFROM prompts\nWHERE owner_id = 'dev-user-001'\nORDER BY created_at DESC;\n\`\`\``,
          },
        ],
        modelDefaults: {
          model: 'gpt-4o-mini',
          temperature: 0.1,
          maxTokens: 1024,
        },
      },
      ownerId,
    );

    // 3. Technical API Explainer (RTF, custom)
    await this.create(
      {
        name: 'API Endpoint Explainer & Guide',
        description: 'Generates clean developer-friendly endpoint breakdowns with headers and potential errors.',
        techniques: ['RTF', 'custom'],
        templateBody: `Role: Staff Technical Documentation Lead\nTask: Explain the following API endpoint specification for {{target_audience}}.\nFormat: Provide a 2-sentence summary, required request headers, expected HTTP status codes, and common failure scenarios.\n\nEndpoint Definition:\n{{endpoint_spec}}`,
        variables: [
          {
            name: 'endpoint_spec',
            description: 'HTTP method, path, and request/response contract',
            required: true,
            defaultValue: 'POST /v1/chat/completions (Authorization: Bearer <key>, Body: { model: string, messages: array })',
          },
          {
            name: 'target_audience',
            description: 'Audience reading the docs',
            required: true,
            defaultValue: 'Junior Frontend Developers integrating mobile apps',
          },
        ],
        modelDefaults: {
          model: 'gpt-4o-mini',
          temperature: 0.5,
          maxTokens: 768,
        },
      },
      ownerId,
    );
  }

  /**
   * Lists all prompts with metadata, version counts, and latest version information.
   */
  async findAll(params?: { search?: string; technique?: string }): Promise<PromptSummary[]> {
    const where: Prisma.PromptWhereInput = {};

    if (params?.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { description: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const prompts = await this.prisma.prompt.findMany({
      where,
      include: {
        owner: {
          select: { id: true, displayName: true, email: true },
        },
        versions: {
          orderBy: { versionNumber: 'desc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const result: PromptSummary[] = [];

    for (const p of prompts) {
      const techniqueMetadata = (p.techniqueMetadata as Record<string, unknown>) || {};
      const techniques = Array.isArray(techniqueMetadata.techniques)
        ? (techniqueMetadata.techniques as string[])
        : [];

      // Filter by technique if specified
      if (params?.technique && !techniques.includes(params.technique)) {
        continue;
      }

      const latestVersion = p.versions[0];

      result.push({
        id: p.id,
        name: p.name,
        description: p.description,
        techniques,
        versionCount: p.versions.length,
        latestVersionNumber: latestVersion ? latestVersion.versionNumber : 1,
        latestTemplateBody: latestVersion ? latestVersion.templateBody : '',
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        owner: p.owner,
      });
    }

    return result;
  }

  /**
   * Retrieves a prompt by ID with all immutable versions in descending order.
   */
  async findById(id: string): Promise<PromptDetail> {
    const prompt = await this.prisma.prompt.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true, displayName: true, email: true },
        },
        versions: {
          orderBy: { versionNumber: 'desc' },
        },
      },
    });

    if (!prompt) {
      throw new NotFoundException(`Prompt with ID "${id}" was not found.`);
    }

    const techniqueMetadata = (prompt.techniqueMetadata as Record<string, unknown>) || {};
    const techniques = Array.isArray(techniqueMetadata.techniques)
      ? (techniqueMetadata.techniques as string[])
      : [];

    return {
      id: prompt.id,
      name: prompt.name,
      description: prompt.description,
      techniques,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt,
      owner: prompt.owner,
      versions: prompt.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        templateBody: v.templateBody,
        variables: (v.variables as unknown as PromptVariableDto[]) || [],
        examples: (v.examples as unknown as FewShotExampleDto[]) || [],
        outputSchema: (v.outputSchema as Record<string, unknown>) || null,
        modelDefaults: (v.modelDefaults as Record<string, unknown>) || {},
        createdAt: v.createdAt,
        createdBy: v.createdBy,
      })),
    };
  }

  /**
   * Creates a prompt and its initial immutable version (v1).
   */
  async create(dto: CreatePromptDto, userId = 'dev-user-001'): Promise<PromptDetail> {
    const autoVariables = this.extractVariables(dto.templateBody);
    const variables = dto.variables && dto.variables.length > 0
      ? dto.variables
      : autoVariables.map((v) => ({ name: v, required: true }));

    const techniques = dto.techniques || ['zero-shot'];

    const prompt = await this.prisma.prompt.create({
      data: {
        ownerId: userId,
        name: dto.name,
        description: dto.description || null,
        techniqueMetadata: {
          techniques,
        },
        versions: {
          create: {
            versionNumber: 1,
            templateBody: dto.templateBody,
            variables: variables as unknown as Prisma.InputJsonValue,
            examples: (dto.examples || []) as unknown as Prisma.InputJsonValue,
            outputSchema: (dto.outputSchema || null) as unknown as Prisma.InputJsonValue,
            modelDefaults: (dto.modelDefaults || { model: 'gpt-4o-mini' }) as unknown as Prisma.InputJsonValue,
            createdBy: userId,
          },
        },
      },
      include: {
        owner: {
          select: { id: true, displayName: true, email: true },
        },
        versions: true,
      },
    });

    return this.findById(prompt.id);
  }

  /**
   * Appends a new immutable version (v+1) to an existing prompt in a transaction.
   * Concurrency-safe against race conditions via DB unique constraint [promptId, versionNumber].
   * Historical versions remain strictly immutable.
   */
  async createVersion(promptId: string, dto: CreateVersionDto, userId = 'dev-user-001'): Promise<PromptDetail> {
    const autoVariables = this.extractVariables(dto.templateBody);
    const variables = dto.variables && dto.variables.length > 0
      ? dto.variables
      : autoVariables.map((v) => ({ name: v, required: true }));

    const updateData: Prisma.PromptUpdateInput = {};
    if (dto.name) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.techniques) {
      updateData.techniqueMetadata = { techniques: dto.techniques };
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const prompt = await tx.prompt.findUnique({
          where: { id: promptId },
          include: {
            versions: {
              orderBy: { versionNumber: 'desc' },
              take: 1,
              select: { versionNumber: true },
            },
          },
        });

        if (!prompt) {
          throw new NotFoundException(`Prompt with ID "${promptId}" was not found.`);
        }

        const latestVersionNumber = prompt.versions[0]?.versionNumber || 0;
        const nextVersionNumber = latestVersionNumber + 1;

        await tx.promptVersion.create({
          data: {
            promptId,
            versionNumber: nextVersionNumber,
            templateBody: dto.templateBody,
            variables: variables as unknown as Prisma.InputJsonValue,
            examples: (dto.examples || []) as unknown as Prisma.InputJsonValue,
            outputSchema: (dto.outputSchema || null) as unknown as Prisma.InputJsonValue,
            modelDefaults: (dto.modelDefaults || { model: 'gpt-4o-mini' }) as unknown as Prisma.InputJsonValue,
            createdBy: userId,
          },
        });

        await tx.prompt.update({
          where: { id: promptId },
          data: {
            ...updateData,
            updatedAt: new Date(),
          },
        });
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'A new version for this prompt was created concurrently by another operation. Please reload and submit again.',
        );
      }
      throw err;
    }

    return this.findById(promptId);
  }

  /**
   * Extracts unique {{variable_name}} tokens from template text.
   */
  extractVariables(templateBody: string): string[] {
    const regex = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;
    const matches = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = regex.exec(templateBody)) !== null) {
      matches.add(match[1]);
    }

    return Array.from(matches);
  }

  /**
   * Resolves template variables while strictly preserving whitespace, line breaks, and indentation.
   */
  resolveTemplate(dto: PreviewPromptDto): ResolvedPreview {
    const detected = this.extractVariables(dto.templateBody);
    const values = dto.variables || {};
    const missing: string[] = [];

    let resolved = dto.templateBody;

    for (const varName of detected) {
      const val = values[varName];
      if (val === undefined || val === null || val === '') {
        missing.push(varName);
      } else {
        // Replace all occurrences of {{varName}} with the exact string
        const pattern = new RegExp(`\\{\\{\\s*${varName}\\s*\\}\\}`, 'g');
        resolved = resolved.replace(pattern, val);
      }
    }

    // If few-shot examples are provided, assemble them if not already part of template
    if (dto.examples && dto.examples.length > 0 && !dto.templateBody.includes('### Examples')) {
      const examplesBlock = dto.examples
        .map((ex, i) => `Example ${i + 1}:\nInput: ${ex.input}\nOutput: ${ex.output}`)
        .join('\n\n');

      resolved = `${resolved}\n\n### Examples:\n${examplesBlock}`;
    }

    return {
      resolvedPrompt: resolved,
      detectedVariables: detected,
      missingVariables: missing,
      characterCount: resolved.length,
      estimatedTokens: this.providersService.estimateTokens(resolved),
    };
  }

  /**
   * Executes a prompt run through LiteLLM Gateway after validating variables.
   */
  async runPlayground(dto: RunPlaygroundDto): Promise<PlaygroundRunResult> {
    const preview = this.resolveTemplate({
      templateBody: dto.templateBody,
      variables: dto.variables,
      examples: dto.examples,
    });

    if (preview.missingVariables.length > 0) {
      throw new BadRequestException(
        `Cannot run prompt: missing required variable(s): ${preview.missingVariables.join(', ')}`,
      );
    }

    const estimatedTokens = preview.estimatedTokens + (dto.maxTokens || 1024);
    const requestId = `req-play-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    if (this.usageService) {
      await this.usageService.reserveUsage({
        requestId,
        model: dto.model,
        provider: 'gateway',
        estimatedTokens,
      });
    }

    const completionResult = await this.providersService.executeChatCompletion({
      model: dto.model,
      messages: [
        {
          role: 'user',
          content: preview.resolvedPrompt,
        },
      ],
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
    });

    if (this.usageService) {
      await this.usageService.reconcileUsage({
        requestId,
        success: completionResult.success,
        usage: completionResult.usage,
        latencyMs: completionResult.latencyMs,
        error: completionResult.errorMessage,
      });
    }

    return {
      ...completionResult,
      resolvedPrompt: preview.resolvedPrompt,
    };
  }
}
