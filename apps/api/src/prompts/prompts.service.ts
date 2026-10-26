import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService, CompletionResult } from '../providers/providers.service';
import { LlmExecutionService } from '../llm/llm-execution.service';
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
  traceId?: string;
}

@Injectable()
export class PromptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providersService: ProvidersService,
    private readonly llmExecutionService: LlmExecutionService,
  ) {}

  /**
   * Lists all prompts with metadata, version counts, and latest version information.
   * Scoped to the authenticated owner.
   * Supports deterministic pagination (limit and offset).
   */
  async findAll(
    userId: string,
    params?: {
      search?: string;
      technique?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<PromptSummary[]> {
    const where: Prisma.PromptWhereInput = {
      ownerId: userId,
    };

    if (params?.search) {
      where.AND = [
        {
          OR: [
            { name: { contains: params.search, mode: 'insensitive' } },
            { description: { contains: params.search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const hasTechniqueFilter = Boolean(params?.technique);
    const offset = params?.offset !== undefined ? Math.max(0, params.offset) : 0;
    const limit = params?.limit !== undefined ? Math.min(Math.max(1, params.limit), 100) : 50;

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
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      ...(!hasTechniqueFilter && (params?.limit !== undefined || params?.offset !== undefined)
        ? { skip: offset, take: limit }
        : {}),
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

    if (params?.limit !== undefined || params?.offset !== undefined) {
      if (!hasTechniqueFilter) {
        return result;
      }
      return result.slice(offset, offset + limit);
    }

    return result;
  }

  /**
   * Retrieves a prompt by ID with all immutable versions in descending order.
   */
  async findById(id: string, userId: string): Promise<PromptDetail> {
    const prompt = await this.prisma.prompt.findFirst({
      where: { id, ownerId: userId },
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
  async create(dto: CreatePromptDto, userId: string): Promise<PromptDetail> {
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

    return this.findById(prompt.id, userId);
  }

  /**
   * Appends a new immutable version (v+1) to an existing prompt in a transaction.
   * Concurrency-safe against race conditions via DB unique constraint [promptId, versionNumber].
   * Historical versions remain strictly immutable.
   */
  async createVersion(promptId: string, dto: CreateVersionDto, userId: string): Promise<PromptDetail> {
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
        const prompt = await tx.prompt.findFirst({
          where: { id: promptId, ownerId: userId },
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

    return this.findById(promptId, userId);
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
        // Replace all occurrences of {{varName}} with the exact string without dollar pattern expansion
        const pattern = new RegExp(`\\{\\{\\s*${varName}\\s*\\}\\}`, 'g');
        resolved = resolved.replace(pattern, () => val);
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
  async runPlayground(
    dto: RunPlaygroundDto,
    userId: string,
    idempotencyKey?: string,
  ): Promise<PlaygroundRunResult> {
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

    const execution = await this.llmExecutionService.execute({
      userId,
      operation: 'playground.execute',
      model: dto.model,
      provider: 'gateway',
      name: `Playground (${dto.model})`,
      messages: [
        {
          role: 'user',
          content: preview.resolvedPrompt,
        },
      ],
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      idempotencyKey,
    });

    return {
      ...execution,
      resolvedPrompt: preview.resolvedPrompt,
    };
  }
}
