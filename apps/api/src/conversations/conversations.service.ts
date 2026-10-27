import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { ModelCatalogService } from '../providers/model-catalog.service';
import { TokenCounterService } from '../tokens/token-counter.service';
import { LlmExecutionService } from '../llm/llm-execution.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import {
  PreviewCompactionDto,
  ApplyCompactionDto,
} from './dto/compact-conversation.dto';
import {
  getModelContextPolicy,
  getMaxInputBudget,
  AssembledContextMessage,
  ContextInspectionResult,
  assembleConversationContext,
} from './context-policy';
import { Prisma, ConversationMessage } from '@prisma/client';
import { conflict } from '../common/utils/conflict.util';

import {
  buildCompactionMessages,
  buildFallbackSummary,
  CompactionFallbackReason,
  parseCompactionOutput,
} from './compaction-summary';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providersService: ProvidersService,
    private readonly llmExecutionService: LlmExecutionService,
    private readonly modelCatalog: ModelCatalogService,
    private readonly tokenCounter: TokenCounterService,
  ) {}

  /**
   * Creates a new conversation with optional initial system instructions.
   */
  async create(dto: CreateConversationDto, userId: string) {
    const ownerId = userId;

    const title =
      dto.title?.trim() ||
      `Conversation (${dto.model} — ${new Date().toLocaleDateString()})`;

    const systemPromptContent = dto.systemPrompt?.trim();
    const hasSystemPrompt = Boolean(
      systemPromptContent && systemPromptContent.length > 0,
    );

    const maxInputBudget = await this.modelCatalog.getMaxInputBudget(dto.model);
    const storedBudget =
      typeof dto.contextBudget === 'number' && dto.contextBudget > 0
        ? Math.min(dto.contextBudget, maxInputBudget)
        : null;

    const conversation = await this.prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          ownerId,
          title,
          provider: dto.provider,
          model: dto.model,
          contextBudget: storedBudget,
          status: 'active',
          lastSequence: hasSystemPrompt ? 1 : 0,
        },
      });

      if (hasSystemPrompt) {
        await tx.conversationMessage.create({
          data: {
            conversationId: conv.id,
            role: 'system',
            content: systemPromptContent!,
            sequenceNumber: 1,
            status: 'complete',
            inputTokens: this.tokenCounter.countText(systemPromptContent!, dto.model).tokens,
            tokenUsageSource: 'estimated',
          },
        });
      }

      return conv;
    });

    return this.findOne(conversation.id, ownerId);
  }


  /**
   * Lists all conversations.
   * Supports deterministic pagination (limit and offset).
   */
  async findAll(userId: string, pagination?: { limit?: number; offset?: number }) {
    const where = { ownerId: userId };
    const take = pagination?.limit !== undefined
      ? Math.min(Math.max(1, pagination.limit), 100)
      : (pagination?.offset !== undefined ? 50 : undefined);
    const skip = pagination?.offset !== undefined ? Math.max(0, pagination.offset) : undefined;

    const list = await this.prisma.conversation.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take,
      skip,
      include: {
        messages: {
          orderBy: { sequenceNumber: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            sequenceNumber: true,
            status: true,
            createdAt: true,
          },
        },
        checkpoints: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return list.map((c) => {
      const lastMessage =
        c.messages.length > 0 ? c.messages[c.messages.length - 1] : null;
      return {
        id: c.id,
        title: c.title,
        provider: c.provider,
        model: c.model,
        contextBudget: c.contextBudget,
        status: c.status,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c.messages.length,
        checkpointCount: c.checkpoints.length,
        hasActiveCheckpoint: c.checkpoints.length > 0,
        lastMessageSnippet: lastMessage
          ? lastMessage.content.slice(0, 120)
          : null,
        lastMessageRole: lastMessage ? lastMessage.role : null,
      };
    });
  }

  /**
   * Finds a conversation by ID with all messages and checkpoints.
   * Scoped to the authenticated owner.
   */
  async findOne(id: string, userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id,
        ownerId: userId,
      },
      include: {
        messages: {
          orderBy: { sequenceNumber: 'asc' },
        },
        checkpoints: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation with ID "${id}" was not found.`);
    }

    const activeCheckpoint = conversation.activeCheckpointId
      ? conversation.checkpoints.find((c) => c.id === conversation.activeCheckpointId) || null
      : conversation.checkpoints.length > 0
        ? conversation.checkpoints[0]
        : null;

    return {
      id: conversation.id,
      ownerId: conversation.ownerId,
      title: conversation.title,
      provider: conversation.provider,
      model: conversation.model,
      contextBudget: conversation.contextBudget,
      status: conversation.status,
      activeCheckpointId: conversation.activeCheckpointId,
      lastSequence: conversation.lastSequence,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages,
      checkpoints: conversation.checkpoints,
      activeCheckpoint,
    };
  }

  /**
   * Deletes a conversation by ID.
   * Scoped to the authenticated owner.
   */
  async delete(id: string, userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id,
        ownerId: userId,
      },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation with ID "${id}" was not found.`);
    }

    await this.prisma.conversation.delete({ where: { id } });
    return { success: true, id };
  }


  /**
   * Assembles the active context that will be sent to the LLM
   * and calculates honest token estimates and context limit comparisons.
   */
  async inspectContext(
    id: string,
    proposedInput: string | undefined,
    userId: string,
  ): Promise<ContextInspectionResult> {
    const conv = await this.loadContextState(id, userId, { withCounts: true });
    const policy = await this.modelCatalog.getModelContextPolicy(conv.model);
    const counter = this.tokenCounter.createCounter(conv.model, conv.provider);
    return assembleConversationContext(conv, proposedInput, policy, counter);
  }

  /**
   * Loads only what context assembly needs: the owner-scoped conversation row, its active
   * checkpoint, the system message, and the messages after the checkpoint's compacted sequence.
   * Message counts that cover the whole history are fetched as aggregates when requested.
   */
  private async loadContextState(
    id: string,
    userId: string,
    options?: { withCounts?: boolean },
  ) {
    const checkpointSelect = {
      id: true,
      summary: true,
      retainedFacts: true,
      compactedThroughSequence: true,
      createdAt: true,
    } satisfies Prisma.ConversationCheckpointSelect;

    const row = await this.prisma.conversation.findFirst({
      where: { id, ownerId: userId },
      select: {
        id: true,
        ownerId: true,
        provider: true,
        model: true,
        contextBudget: true,
        activeCheckpointId: true,
        activeCheckpoint: { select: checkpointSelect },
        checkpoints: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: checkpointSelect,
        },
      },
    });

    if (!row) {
      throw new NotFoundException(`Conversation with ID "${id}" was not found.`);
    }

    const { activeCheckpoint: linkedCheckpoint, checkpoints, ...conversation } = row;
    const activeCheckpoint = row.activeCheckpointId
      ? linkedCheckpoint
      : checkpoints.length > 0
        ? checkpoints[0]
        : null;
    const compactedThrough = activeCheckpoint ? activeCheckpoint.compactedThroughSequence : 0;

    const messagesPromise = this.prisma.conversationMessage.findMany({
      where: {
        conversationId: conversation.id,
        status: { not: 'failed' },
        OR: [
          { sequenceNumber: { gt: compactedThrough } },
          { role: 'system', sequenceNumber: 1 },
        ],
      },
      orderBy: { sequenceNumber: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        sequenceNumber: true,
        status: true,
        createdAt: true,
      },
    });

    if (!options?.withCounts) {
      return { ...conversation, activeCheckpoint, messages: await messagesPromise };
    }

    const [messages, totalMessageCount, compactedMessageCount] = await Promise.all([
      messagesPromise,
      this.prisma.conversationMessage.count({ where: { conversationId: conversation.id } }),
      activeCheckpoint
        ? this.prisma.conversationMessage.count({
            where: {
              conversationId: conversation.id,
              sequenceNumber: { lte: compactedThrough },
              status: { not: 'failed' },
              NOT: { role: 'system', sequenceNumber: 1 },
            },
          })
        : Promise.resolve(0),
    ]);

    return {
      ...conversation,
      activeCheckpoint,
      messages,
      totalMessageCount,
      compactedMessageCount,
    };
  }

  /**
   * Appends a user message, dispatches the assembled context to the model,
   * and appends the assistant response with usage metadata.
   */
  async sendMessage(
    id: string,
    dto: SendMessageDto,
    userId: string,
    idempotencyKey?: string,
  ) {
    if (!dto.content || dto.content.trim().length === 0) {
      throw new BadRequestException('Message content cannot be empty.');
    }

    const conv = await this.loadContextState(id, userId);

    // 1. Build assembled context payload including proposed current input via shared assembly
    const policy = await this.modelCatalog.getModelContextPolicy(conv.model);
    const counter = this.tokenCounter.createCounter(conv.model, conv.provider);
    const inspection = assembleConversationContext(conv, dto.content.trim(), policy, counter);

    // After sliding window truncation of dialogue messages, total estimated tokens
    // are <= effectiveBudget unless the pinned essential tokens alone (system prompt,
    // active checkpoint summary, and new user message) exceed the budget.
    // Thus checking essentialTokensExceeded (or !withinBudget) catches impossible budgets fail-fast.
    if (inspection.essentialTokensExceeded || !inspection.withinBudget) {
      throw conflict('CONTEXT_BUDGET_EXCEEDED');
    }

    const messagesPayload = inspection.assembledMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // 2. Dispatch to model gateway via centralized LlmExecutionService
    const execution = await this.llmExecutionService.execute({
      userId: conv.ownerId,
      operation: 'conversation.turn',
      model: conv.model,
      provider: conv.provider,
      name: `Conversation Turn (${conv.model})`,
      conversationId: conv.id,
      messages: messagesPayload,
      temperature: 0.7,
      maxTokens: 1024,
      idempotencyKey,
    });

    // 3. Handle Replay:
    // If execution was replayed from an earlier execution, load the turn BY requestId.
    // If not both messages exist yet (in-flight persistence window), return 409 REQUEST_IN_PROGRESS,
    // or 409 IDEMPOTENCY_RESULT_UNAVAILABLE if the usage record is reconciled but messages are missing after a 30s grace period.
    if (execution.isReplay) {
      if (execution.requestId) {
        const turnMessages = await this.prisma.conversationMessage.findMany({
          where: {
            conversationId: conv.id,
            requestId: execution.requestId,
          },
          orderBy: { sequenceNumber: 'asc' },
        });

        const userMsg = turnMessages.find((m) => m.role === 'user');
        const assistantMsg = turnMessages.find((m) => m.role === 'assistant');

        if (userMsg && assistantMsg) {
          return {
            success: true,
            userMessage: userMsg,
            assistantMessage: assistantMsg,
            latencyMs: execution.latencyMs,
            usage: execution.usage,
            traceId: execution.traceId,
          };
        }

        // Check if usage record was reconciled and is older than 30s grace period
        const usageRecord = await this.prisma.usageRecord.findUnique({
          where: {
            userId_requestId: {
              userId: conv.ownerId,
              requestId: execution.requestId,
            },
          },
        });

        if (usageRecord?.status === 'reconciled' && usageRecord.reconciledAt) {
          const ageMs = Date.now() - usageRecord.reconciledAt.getTime();
          if (ageMs > 30_000) {
            throw conflict('IDEMPOTENCY_RESULT_UNAVAILABLE');
          }
        }
      }

      throw conflict('REQUEST_IN_PROGRESS');
    }

    if (!execution.success) {
      // Create user message marked as 'failed' if provider failed, allocating sequence number atomically
      let userMessage: ConversationMessage;
      try {
        userMessage = await this.prisma.$transaction(async (tx) => {
          const updatedConv = await tx.conversation.update({
            where: { id: conv.id },
            data: {
              lastSequence: { increment: 1 },
              updatedAt: new Date(),
            },
            select: { lastSequence: true },
          });

          return await tx.conversationMessage.create({
            data: {
              conversationId: conv.id,
              requestId: execution.requestId,
              role: 'user',
              content: dto.content.trim(),
              sequenceNumber: updatedConv.lastSequence,
              status: 'failed',
              inputTokens: this.tokenCounter.countText(dto.content, conv.model, conv.provider).tokens,
              tokenUsageSource: 'estimated',
            },
          });
        });
      } catch (error: any) {
        if (this.isRequestIdUniqueViolation(error) && execution.requestId) {
          const existing = await this.prisma.conversationMessage.findFirst({
            where: {
              conversationId: conv.id,
              requestId: execution.requestId,
              role: 'user',
            },
          });
          if (existing) {
            userMessage = existing;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      return {
        success: false,
        userMessage,
        assistantMessage: null,
        errorType: execution.errorType,
        errorMessage: execution.errorMessage || 'Provider failed to generate response',
        configurationHint: execution.configurationHint,
        traceId: execution.traceId,
      };
    }

    // 4. Persist user message and assistant response together atomically in transaction
    let userMessage: ConversationMessage;
    let assistantMessage: ConversationMessage;

    try {
      const persistedTurn = await this.prisma.$transaction(async (tx) => {
        const updatedConv = await tx.conversation.update({
          where: { id: conv.id },
          data: {
            lastSequence: { increment: 2 },
            updatedAt: new Date(),
          },
          select: { lastSequence: true },
        });

        const assistantSeq = updatedConv.lastSequence;
        const userSeq = assistantSeq - 1;

        const uMsg = await tx.conversationMessage.create({
          data: {
            conversationId: conv.id,
            requestId: execution.requestId,
            role: 'user',
            content: dto.content.trim(),
            sequenceNumber: userSeq,
            status: 'complete',
            inputTokens: this.tokenCounter.countText(dto.content, conv.model, conv.provider).tokens,
            tokenUsageSource: 'estimated',
          },
        });

        const aMsg = await tx.conversationMessage.create({
          data: {
            conversationId: conv.id,
            requestId: execution.requestId,
            role: 'assistant',
            content: execution.content || '',
            sequenceNumber: assistantSeq,
            status: 'complete',
            inputTokens: execution.usage?.promptTokens || this.tokenCounter.countText(dto.content, conv.model, conv.provider).tokens,
            outputTokens: execution.usage?.completionTokens || this.tokenCounter.countText(execution.content || '', conv.model, conv.provider).tokens,
            tokenUsageSource: execution.usage?.source || 'provider-reported',
          },
        });

        return { userMessage: uMsg, assistantMessage: aMsg };
      });

      userMessage = persistedTurn.userMessage;
      assistantMessage = persistedTurn.assistantMessage;
    } catch (error: any) {
      // Treat P2002 unique constraint violation as already persisted by a racing execution ONLY if target is requestId
      if (this.isRequestIdUniqueViolation(error) && execution.requestId) {
        const turnMessages = await this.prisma.conversationMessage.findMany({
          where: {
            conversationId: conv.id,
            requestId: execution.requestId,
          },
          orderBy: { sequenceNumber: 'asc' },
        });
        const uMsg = turnMessages.find((m) => m.role === 'user');
        const aMsg = turnMessages.find((m) => m.role === 'assistant');
        if (uMsg && aMsg) {
          userMessage = uMsg;
          assistantMessage = aMsg;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    return {
      success: true,
      userMessage,
      assistantMessage,
      latencyMs: execution.latencyMs,
      usage: execution.usage,
      traceId: execution.traceId,
    };
  }

  /**
   * Identifies whether a Prisma P2002 unique constraint violation is specifically
   * for the requestId constraint (conversationId, requestId, role).
   * Non-requestId collisions (e.g. sequenceNumber) must not be treated as already persisted.
   */
  private isRequestIdUniqueViolation(error: any): boolean {
    if (error?.code !== 'P2002') {
      return false;
    }
    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.includes('requestId');
    }
    if (typeof target === 'string') {
      return (
        target.includes('requestId') ||
        target.includes('conversationId_requestId_role')
      );
    }
    return false;
  }

  /**
   * Generates a proposed compaction summary and facts list for manual user review.
   */
  async previewCompaction(
    id: string,
    dto: PreviewCompactionDto | undefined,
    userId: string,
    idempotencyKey?: string,
  ) {
    const conv = await this.findOne(id, userId);
    const nonSystemMessages = conv.messages.filter(
      (m) =>
        !(m.role === 'system' && m.sequenceNumber === 1) &&
        m.status !== 'failed',
    );

    if (nonSystemMessages.length < 3) {
      throw new BadRequestException(
        'At least 3 conversation messages are required to perform compaction.',
      );
    }

    const currentCompactedThrough = conv.activeCheckpoint
      ? conv.activeCheckpoint.compactedThroughSequence
      : 0;

    const maxSeq = nonSystemMessages.reduce(
      (max, m) => Math.max(max, m.sequenceNumber),
      0,
    );

    // Leave at least the last 2 messages uncompacted for immediate conversational continuity
    const defaultTarget = Math.max(currentCompactedThrough + 1, maxSeq - 2);
    const targetSeq = dto?.compactThroughSequence || defaultTarget;

    if (targetSeq <= currentCompactedThrough) {
      throw new BadRequestException(
        `Target sequence (${targetSeq}) must be greater than current compacted sequence (${currentCompactedThrough}).`,
      );
    }

    if (targetSeq >= maxSeq) {
      throw new BadRequestException(
        `Cannot compact through the latest message (${maxSeq}). At least recent turns must remain uncompacted.`,
      );
    }

    const messagesToCompact = nonSystemMessages.filter(
      (m) =>
        m.sequenceNumber > currentCompactedThrough &&
        m.sequenceNumber <= targetSeq,
    );

    if (messagesToCompact.length === 0) {
      throw new BadRequestException('No uncompacted messages found in the specified range.');
    }

    const estimatedTokensBefore = messagesToCompact.reduce(
      (sum, m) => sum + this.tokenCounter.countText(m.content, conv.model, conv.provider).tokens,
      0,
    );

    // Instructions and transcript travel in separate messages; the model must answer with JSON.
    const llmResult = await this.llmExecutionService.execute({
      userId: conv.ownerId,
      operation: 'compaction.preview',
      model: conv.model,
      provider: conv.provider,
      name: `Compaction Summarization (${conv.model})`,
      conversationId: conv.id,
      messages: buildCompactionMessages(messagesToCompact),
      temperature: 0.2,
      maxTokens: 1024,
      responseFormat: { type: 'json_object' },
      metadata: { targetSeq },
      idempotencyKey,
    });

    let compaction = llmResult.success ? parseCompactionOutput(llmResult.content) : null;
    let summarySource: 'model' | 'fallback' = 'model';
    let fallbackReason: CompactionFallbackReason | null = null;

    if (!compaction) {
      fallbackReason = llmResult.success ? 'invalid_model_output' : 'provider_error';
      this.logger.warn(
        `Compaction for conversation ${conv.id} fell back to a deterministic summary (${fallbackReason}` +
          `${llmResult.success ? '' : `: ${llmResult.errorMessage}`}).`,
      );
      compaction = buildFallbackSummary(messagesToCompact);
      summarySource = 'fallback';
    }

    const summaryText = compaction.summary;
    const retainedFacts = compaction.retainedFacts;

    const estimatedTokensAfter =
      this.tokenCounter.countText(summaryText, conv.model, conv.provider).tokens +
      retainedFacts.reduce(
        (sum, f) => sum + this.tokenCounter.countText(f, conv.model, conv.provider).tokens,
        0,
      );

    return {
      conversationId: conv.id,
      compactThroughSequence: targetSeq,
      messagesToCompactCount: messagesToCompact.length,
      estimatedTokensBefore,
      estimatedTokensAfter,
      tokenSavings: Math.max(0, estimatedTokensBefore - estimatedTokensAfter),
      proposedSummary: summaryText,
      proposedRetainedFacts: retainedFacts,
      providerReported: llmResult.success,
      providerError: !llmResult.success ? llmResult.errorMessage : null,
      summarySource,
      fallbackReason,
    };
  }

  /**
   * Applies and persists a conversation compaction checkpoint.
   * Crucially, all original conversation messages remain stored in PostgreSQL.
   */
  async applyCompaction(id: string, dto: ApplyCompactionDto, userId: string) {
    if (!dto.summary || dto.summary.trim().length === 0) {
      throw new BadRequestException('Compaction summary cannot be empty.');
    }

    const checkpointData = await this.prisma.$transaction(async (tx) => {
      // Guard against concurrent applyCompaction calls creating overlapping checkpoints
      // Lock the conversation row in PostgreSQL
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "conversations" WHERE "id" = ${id} AND "ownerId" = ${userId} FOR UPDATE;
      `;

      if (!locked || locked.length === 0) {
        throw new NotFoundException(`Conversation with ID "${id}" was not found.`);
      }

      const conv = await tx.conversation.findUnique({
        where: { id },
        include: {
          messages: {
            orderBy: { sequenceNumber: 'asc' },
          },
          checkpoints: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!conv || (conv.ownerId && conv.ownerId !== userId)) {
        throw new NotFoundException(`Conversation with ID "${id}" was not found.`);
      }

      const activeCheckpoint = conv.activeCheckpointId
        ? conv.checkpoints.find((c) => c.id === conv.activeCheckpointId) || null
        : conv.checkpoints.length > 0
          ? conv.checkpoints[0]
          : null;

      const currentCompactedThrough = activeCheckpoint
        ? activeCheckpoint.compactedThroughSequence
        : 0;

      const nonSystemMessages = conv.messages.filter((m) => m.role !== 'system');
      const maxSeq = nonSystemMessages.reduce(
        (max, m) => Math.max(max, m.sequenceNumber),
        0,
      );

      // Validate the requested compaction range:
      // compactedThroughSequence must be > activeCheckpoint.compactedThroughSequence and < latest message sequence.
      // Return 400 with { message, code: 'INVALID_COMPACTION_RANGE' } otherwise.
      if (dto.compactedThroughSequence <= currentCompactedThrough) {
        throw new BadRequestException({
          message: `Target sequence (${dto.compactedThroughSequence}) must be greater than current active checkpoint sequence (${currentCompactedThrough}).`,
          code: 'INVALID_COMPACTION_RANGE',
        });
      }

      if (dto.compactedThroughSequence >= maxSeq) {
        throw new BadRequestException({
          message: `Cannot compact through or beyond latest message (${maxSeq}). Recent turns must remain uncompacted.`,
          code: 'INVALID_COMPACTION_RANGE',
        });
      }

      const created = await tx.conversationCheckpoint.create({
        data: {
          conversationId: conv.id,
          summary: dto.summary.trim(),
          retainedFacts: (dto.retainedFacts || []) as unknown as Prisma.InputJsonValue,
          compactedThroughSequence: dto.compactedThroughSequence,
          contextPolicyVersion: 'v1',
        },
      });

      // Update activeCheckpointId and updatedAt in one transaction
      await tx.conversation.update({
        where: { id: conv.id },
        data: {
          activeCheckpointId: created.id,
          updatedAt: new Date(),
        },
      });

      return { checkpoint: created, conv };
    });

    const policy = await this.modelCatalog.getModelContextPolicy(checkpointData.conv.model);
    const counter = this.tokenCounter.createCounter(checkpointData.conv.model, checkpointData.conv.provider);
    const inspection = assembleConversationContext({
      ...checkpointData.conv,
      activeCheckpointId: checkpointData.checkpoint.id,
      activeCheckpoint: checkpointData.checkpoint,
      checkpoints: [checkpointData.checkpoint, ...checkpointData.conv.checkpoints],
    }, undefined, policy, counter);

    return {
      success: true,
      checkpoint: {
        id: checkpointData.checkpoint.id,
        summary: checkpointData.checkpoint.summary,
        retainedFacts: dto.retainedFacts || [],
        compactedThroughSequence: checkpointData.checkpoint.compactedThroughSequence,
        createdAt: checkpointData.checkpoint.createdAt,
      },
      contextStatus: inspection,
    };
  }

  /**
   * Resumes conversation from a selected checkpoint.
   * Confirms active checkpoint, persists activeCheckpointId, and provides context inspection.
   */
  async resume(id: string, checkpointId: string | undefined, userId: string) {
    const conv = await this.findOne(id, userId);

    let targetCheckpoint = conv.activeCheckpoint;
    let targetCheckpointId: string | null = null;

    if (checkpointId) {
      const found = conv.checkpoints.find((c) => c.id === checkpointId);
      if (!found) {
        throw new NotFoundException(`Checkpoint with ID "${checkpointId}" was not found.`);
      }
      targetCheckpoint = found;
      targetCheckpointId = found.id;
    } else {
      targetCheckpointId = conv.activeCheckpoint?.id ?? null;
    }

    if (targetCheckpointId !== conv.activeCheckpointId) {
      await this.prisma.conversation.update({
        where: { id: conv.id },
        data: {
          activeCheckpointId: targetCheckpointId,
          updatedAt: new Date(),
        },
      });
    }

    const updatedConv = {
      ...conv,
      activeCheckpointId: targetCheckpointId,
      activeCheckpoint: targetCheckpoint,
    };
    const policy = await this.modelCatalog.getModelContextPolicy(updatedConv.model);
    const counter = this.tokenCounter.createCounter(updatedConv.model, updatedConv.provider);
    const inspection = assembleConversationContext(updatedConv, undefined, policy, counter);

    return {
      success: true,
      conversationId: conv.id,
      title: conv.title,
      model: conv.model,
      provider: conv.provider,
      activeCheckpoint: targetCheckpoint,
      contextInspection: inspection,
      originalMessagesRetained: conv.messages.length,
      message: 'Conversation resumed successfully. All original history remains preserved in PostgreSQL.',
    };
  }
}
