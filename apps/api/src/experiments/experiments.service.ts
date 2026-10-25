import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { PromptsService } from '../prompts/prompts.service';
import { LlmExecutionService } from '../llm/llm-execution.service';
import { RunComparisonDto, SlotConfigDto, EvaluationCriterionDto, RateExperimentDto } from './dto/run-comparison.dto';
import { Prisma } from '@prisma/client';
import { compileSafeRegex, CompiledRegexResult } from '../common/utils/regex.util';

export interface PreparedCriterion extends EvaluationCriterionDto {
  compiledRegex?: CompiledRegexResult;
}

export interface CriterionResult {
  criterionId: string;
  name: string;
  type: string;
  passed: boolean;
  notes?: string;
}

export interface SlotRunResult {
  slot: 'A' | 'B';
  promptId?: string;
  promptName?: string;
  promptVersionId?: string;
  versionNumber?: number;
  provider: string;
  model: string;
  resolvedPrompt: string;
  status: 'completed' | 'failed';
  output: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenUsageSource: 'provider-reported' | 'estimated';
  estimatedCost: number | null;
  errorCode: string | null;
  errorMessage?: string;
  configurationHint?: string;
  criteriaResults: CriterionResult[];
  manualRating?: number;
  manualNotes?: string;
  traceId?: string;
}

export interface ComparisonResult {
  experimentId: string;
  name: string;
  createdAt: Date;
  commonInput: Record<string, string>;
  slotA: SlotRunResult;
  slotB: SlotRunResult;
}

@Injectable()
export class ExperimentsService {
  private readonly logger = new Logger(ExperimentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providersService: ProvidersService,
    private readonly promptsService: PromptsService,
    private readonly llmExecutionService: LlmExecutionService,
  ) {}

  /**
   * Retrieves all saved comparison experiments ordered newest first.
   * Scoped to the authenticated owner.
   * Supports deterministic pagination (limit and offset).
   */
  async findAll(ownerId: string, pagination?: { limit?: number; offset?: number }) {
    const take = pagination?.limit !== undefined
      ? Math.min(Math.max(1, pagination.limit), 100)
      : (pagination?.offset !== undefined ? 50 : undefined);
    const skip = pagination?.offset !== undefined ? Math.max(0, pagination.offset) : undefined;

    const experiments = await this.prisma.experiment.findMany({
      where: { ownerId },
      include: {
        runs: {
          include: {
            promptVersion: {
              include: {
                prompt: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take,
      skip,
    });

    return experiments.map((exp) => {
      let parsedInput: Record<string, string> = {};
      try {
        parsedInput = JSON.parse(exp.commonInput);
      } catch {
        parsedInput = { input: exp.commonInput };
      }

      const settings = (exp.settings as Record<string, any>) || {};

      return {
        id: exp.id,
        name: exp.name,
        createdAt: exp.createdAt,
        commonInput: parsedInput,
        evaluationCriteria: settings.evaluationCriteria || [],
        evaluations: settings.evaluations || {},
        runs: exp.runs.map((r) => ({
          id: r.id,
          slot: r.slot,
          provider: r.provider,
          model: r.model,
          output: r.output,
          status: r.status,
          latencyMs: r.latencyMs,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          tokenUsageSource: r.tokenUsageSource,
          estimatedCost: r.estimatedCost,
          errorCode: r.errorCode,
          promptVersionId: r.promptVersionId,
          promptId: r.promptVersion?.prompt?.id,
          promptName: r.promptVersion?.prompt?.name,
          versionNumber: r.promptVersion?.versionNumber,
        })),
      };
    });
  }

  /**
   * Retrieves a single comparison experiment by ID.
   * Scoped to the authenticated owner.
   */
  async findById(id: string, ownerId: string) {
    const exp = await this.prisma.experiment.findFirst({
      where: {
        id,
        ownerId,
      },
      include: {
        runs: {
          include: {
            promptVersion: {
              include: {
                prompt: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!exp) {
      throw new NotFoundException(`Experiment with ID "${id}" was not found.`);
    }

    let parsedInput: Record<string, string> = {};
    try {
      parsedInput = JSON.parse(exp.commonInput);
    } catch {
      parsedInput = { input: exp.commonInput };
    }

    const settings = (exp.settings as Record<string, any>) || {};

    return {
      id: exp.id,
      name: exp.name,
      createdAt: exp.createdAt,
      commonInput: parsedInput,
      evaluationCriteria: settings.evaluationCriteria || [],
      evaluations: settings.evaluations || {},
      runs: exp.runs.map((r) => ({
        id: r.id,
        slot: r.slot,
        provider: r.provider,
        model: r.model,
        output: r.output,
        status: r.status,
        latencyMs: r.latencyMs,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        tokenUsageSource: r.tokenUsageSource,
        estimatedCost: r.estimatedCost,
        errorCode: r.errorCode,
        promptVersionId: r.promptVersionId,
        promptId: r.promptVersion?.prompt?.id,
        promptName: r.promptVersion?.prompt?.name,
        versionNumber: r.promptVersion?.versionNumber,
      })),
    };
  }

  /**
   * Runs a side-by-side comparison experiment for Slot A and Slot B.
   * Supports independent execution with partial failure handling.
   * Persists experiment and run records linked to immutable prompt versions.
   */
  async runComparison(dto: RunComparisonDto, userId: string): Promise<ComparisonResult> {
    if (!dto.slotA || !dto.slotB) {
      throw new BadRequestException('Both slotA and slotB configurations are required.');
    }

    // 1. Prepare templates and resolve prompt text for Slot A and Slot B
    // EXP-01b: validate both slots and scope prompt-version lookup to caller
    const resolvedSlotA = await this.prepareSlot(dto.slotA, dto.commonInput, 'slotA', userId);
    const resolvedSlotB = await this.prepareSlot(dto.slotB, dto.commonInput, 'slotB', userId);

    // 2. Pre-compile evaluation criteria once for both slots
    const preparedCriteria = this.prepareCriteria(dto.evaluationCriteria || []);

    // 3. Execute both slots independently via Promise.allSettled for partial failure tolerance
    const [resultA, resultB] = await Promise.allSettled([
      this.executeSlot('A', dto.slotA, resolvedSlotA, preparedCriteria, userId),
      this.executeSlot('B', dto.slotB, resolvedSlotB, preparedCriteria, userId),
    ]);

    const runA: SlotRunResult =
      resultA.status === 'fulfilled'
        ? resultA.value
        : {
            slot: 'A',
            provider: dto.slotA.provider,
            model: dto.slotA.model,
            resolvedPrompt: resolvedSlotA.resolvedPrompt,
            status: 'failed',
            output: null,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            tokenUsageSource: 'estimated',
            estimatedCost: null,
            errorCode: 'EXECUTION_EXCEPTION',
            errorMessage: resultA.reason instanceof Error ? resultA.reason.message : String(resultA.reason),
            criteriaResults: [],
          };

    const runB: SlotRunResult =
      resultB.status === 'fulfilled'
        ? resultB.value
        : {
            slot: 'B',
            provider: dto.slotB.provider,
            model: dto.slotB.model,
            resolvedPrompt: resolvedSlotB.resolvedPrompt,
            status: 'failed',
            output: null,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            tokenUsageSource: 'estimated',
            estimatedCost: null,
            errorCode: 'EXECUTION_EXCEPTION',
            errorMessage: resultB.reason instanceof Error ? resultB.reason.message : String(resultB.reason),
            criteriaResults: [],
          };

    // 3. Persist experiment and runs in PostgreSQL
    const settingsPayload = {
      evaluationCriteria: dto.evaluationCriteria || [],
      evaluations: {
        A: { criteriaResults: runA.criteriaResults },
        B: { criteriaResults: runB.criteriaResults },
      },
    };

    const experiment = await this.prisma.experiment.create({
      data: {
        ownerId: userId,
        name: dto.name || 'Prompt Comparison',
        commonInput: JSON.stringify(dto.commonInput),
        settings: settingsPayload as unknown as Prisma.InputJsonValue,
        runs: {
          create: [
            {
              slot: 'A',
              promptVersionId: dto.slotA.promptVersionId || null,
              provider: runA.provider,
              model: runA.model,
              output: runA.output,
              status: runA.status,
              inputTokens: runA.inputTokens,
              outputTokens: runA.outputTokens,
              tokenUsageSource: runA.tokenUsageSource,
              latencyMs: runA.latencyMs,
              estimatedCost: runA.estimatedCost,
              errorCode: runA.errorCode,
            },
            {
              slot: 'B',
              promptVersionId: dto.slotB.promptVersionId || null,
              provider: runB.provider,
              model: runB.model,
              output: runB.output,
              status: runB.status,
              inputTokens: runB.inputTokens,
              outputTokens: runB.outputTokens,
              tokenUsageSource: runB.tokenUsageSource,
              latencyMs: runB.latencyMs,
              estimatedCost: runB.estimatedCost,
              errorCode: runB.errorCode,
            },
          ],
        },
      },
      include: {
        runs: true,
      },
    });

    return {
      experimentId: experiment.id,
      name: experiment.name,
      createdAt: experiment.createdAt,
      commonInput: dto.commonInput,
      slotA: {
        ...runA,
        promptId: resolvedSlotA.promptId,
        promptName: resolvedSlotA.promptName,
        versionNumber: resolvedSlotA.versionNumber,
      },
      slotB: {
        ...runB,
        promptId: resolvedSlotB.promptId,
        promptName: resolvedSlotB.promptName,
        versionNumber: resolvedSlotB.versionNumber,
      },
    };
  }

  /**
   * Resolves template text and metadata for a slot configuration.
   * EXP-01b: Validates slot configuration before executing LLM completions:
   * - Unknown promptVersionId or version owned by another user throws NotFoundException (404)
   * - Missing or empty templateBody when promptVersionId is omitted throws BadRequestException (400)
   */
  private async prepareSlot(
    slot: SlotConfigDto,
    commonInput: Record<string, string>,
    slotLabel: 'slotA' | 'slotB',
    userId: string,
  ) {
    let templateBody = slot.templateBody?.trim() || '';
    let promptId: string | undefined = slot.promptId;
    let promptName: string | undefined;
    let versionNumber: number | undefined = slot.versionNumber;

    if (slot.promptVersionId) {
      const version = await this.prisma.promptVersion.findFirst({
        where: {
          id: slot.promptVersionId,
          prompt: { ownerId: userId },
        },
        include: { prompt: true },
      });

      if (!version) {
        throw new NotFoundException(
          `Prompt version "${slot.promptVersionId}" for ${slotLabel} was not found.`,
        );
      }

      templateBody = version.templateBody;
      promptId = version.prompt.id;
      promptName = version.prompt.name;
      versionNumber = version.versionNumber;
    }

    if (!templateBody) {
      throw new BadRequestException(
        `${slotLabel} must provide either a valid promptVersionId or a non-empty templateBody.`,
      );
    }

    const preview = this.promptsService.resolveTemplate({
      templateBody,
      variables: commonInput,
    });

    return {
      templateBody,
      resolvedPrompt: preview.resolvedPrompt,
      promptId,
      promptName,
      versionNumber,
    };
  }

  /**
   * Executes a single slot completion and runs evaluation criteria.
   */
  private async executeSlot(
    slotLabel: 'A' | 'B',
    config: SlotConfigDto,
    prepared: { templateBody: string; resolvedPrompt: string; promptId?: string; promptName?: string; versionNumber?: number },
    criteria: (EvaluationCriterionDto | PreparedCriterion)[],
    userId: string,
  ): Promise<SlotRunResult> {
    const execution = await this.llmExecutionService.execute({
      userId,
      operation: 'comparison.slot',
      model: config.model,
      provider: config.provider,
      name: `Comparison Slot ${slotLabel} (${config.model})`,
      messages: [{ role: 'user', content: prepared.resolvedPrompt }],
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      metadata: { slot: slotLabel, promptId: prepared.promptId },
    });

    const isSuccess = execution.success;
    const output = execution.content || null;
    const latencyMs = execution.latencyMs || 0;
    const inputTokens = execution.usage?.promptTokens || 0;
    const outputTokens = execution.usage?.completionTokens || 0;
    const totalTokens = execution.usage?.totalTokens || (inputTokens + outputTokens);
    const tokenUsageSource = execution.usage?.source || 'estimated';
    const estimatedCost = execution.cost;
    const errorCode = !isSuccess ? execution.errorType || 'PROVIDER_ERROR' : null;

    // Evaluate criteria against output
    const criteriaResults = this.evaluateCriteria(output, criteria);

    return {
      slot: slotLabel,
      promptId: prepared.promptId,
      promptName: prepared.promptName,
      promptVersionId: config.promptVersionId,
      versionNumber: prepared.versionNumber,
      provider: config.provider,
      model: config.model,
      resolvedPrompt: prepared.resolvedPrompt,
      status: isSuccess ? 'completed' : 'failed',
      output,
      latencyMs,
      inputTokens,
      outputTokens,
      totalTokens,
      tokenUsageSource,
      estimatedCost,
      errorCode,
      errorMessage: execution.errorMessage,
      configurationHint: execution.configurationHint,
      criteriaResults,
      traceId: execution.traceId,
    };
  }

  /**
   * Pre-compiles regex criteria once to avoid repeated compilation across slots.
   */
  prepareCriteria(criteria: EvaluationCriterionDto[]): PreparedCriterion[] {
    return (criteria || []).map((c) => {
      if (c.type === 'regex') {
        return {
          ...c,
          compiledRegex: compileSafeRegex(c.expectedValue),
        };
      }
      return c;
    });
  }

  /**
   * Evaluates repeatable evaluation criteria against model output.
   */
  evaluateCriteria(output: string | null, criteria: (EvaluationCriterionDto | PreparedCriterion)[]): CriterionResult[] {
    if (!criteria || criteria.length === 0) return [];
    if (!output) {
      return criteria.map((c) => ({
        criterionId: c.id,
        name: c.name,
        type: c.type,
        passed: false,
        notes: 'No output received to evaluate.',
      }));
    }

    return criteria.map((c) => {
      let passed = false;
      let notes = '';

      switch (c.type) {
        case 'contains_text': {
          const expected = (c.expectedValue || '').toLowerCase().trim();
          passed = expected.length > 0 && output.toLowerCase().includes(expected);
          notes = passed ? `Contains "${c.expectedValue}"` : `Missing expected text "${c.expectedValue}"`;
          break;
        }
        case 'regex': {
          const prep = c as PreparedCriterion;
          const compiled = prep.compiledRegex ?? compileSafeRegex(c.expectedValue);
          if (compiled.error) {
            passed = false;
            notes = compiled.error;
            break;
          }
          try {
            passed = compiled.test ? compiled.test(output) : false;
            notes = passed ? 'Matches regex pattern' : 'Did not match regex pattern';
          } catch {
            passed = false;
            notes = 'Invalid regular expression';
          }
          break;
        }
        case 'json_validity': {
          try {
            // Attempt parse or find JSON substring
            const trimmed = output.trim();
            const jsonStart = trimmed.indexOf('{');
            const jsonEnd = trimmed.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd > jsonStart) {
              JSON.parse(trimmed.substring(jsonStart, jsonEnd + 1));
              passed = true;
              notes = 'Valid JSON object';
            } else {
              passed = false;
              notes = 'No JSON block found';
            }
          } catch {
            passed = false;
            notes = 'Malformed JSON syntax';
          }
          break;
        }
        case 'max_length': {
          const max = parseInt(c.expectedValue || '1000', 10);
          passed = output.length <= max;
          notes = passed ? `Length ${output.length} <= ${max}` : `Length ${output.length} exceeds max ${max}`;
          break;
        }
        case 'manual':
        default:
          passed = true;
          notes = 'Requires manual rating';
          break;
      }

      return {
        criterionId: c.id,
        name: c.name,
        type: c.type,
        passed,
        notes,
      };
    });
  }

  /**
   * Updates manual evaluation rating and notes for an experiment slot.
   * Scoped to the authenticated owner.
   */
  async updateRating(id: string, dto: RateExperimentDto, ownerId: string) {
    const exp = await this.prisma.experiment.findFirst({
      where: {
        id,
        ownerId,
      },
    });

    if (!exp) {
      throw new NotFoundException(`Experiment with ID "${id}" was not found.`);
    }

    const currentSettings = (exp.settings as Record<string, any>) || {};
    const evaluations = currentSettings.evaluations || {};
    evaluations[dto.slot] = {
      ...(evaluations[dto.slot] || {}),
      manualRating: dto.rating,
      manualNotes: dto.notes || '',
      ratedAt: new Date().toISOString(),
    };

    const updated = await this.prisma.experiment.update({
      where: { id },
      data: {
        settings: {
          ...currentSettings,
          evaluations,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      experimentId: id,
      slot: dto.slot,
      rating: dto.rating,
      notes: dto.notes,
      evaluations: (updated.settings as any).evaluations,
    };
  }
}
