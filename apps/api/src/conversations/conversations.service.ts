import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { LlmExecutionService } from '../llm/llm-execution.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import {
  PreviewCompactionDto,
  ApplyCompactionDto,
} from './dto/compact-conversation.dto';
import {
  getModelContextPolicy,
  estimateTokens,
  AssembledContextMessage,
  ContextInspectionResult,
} from './context-policy';
import { Prisma, ConversationMessage } from '@prisma/client';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providersService: ProvidersService,
    private readonly llmExecutionService: LlmExecutionService,
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

    const conversation = await this.prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          ownerId,
          title,
          provider: dto.provider,
          model: dto.model,
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
            inputTokens: estimateTokens(systemPromptContent!),
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

    const latestCheckpoint =
      conversation.checkpoints.length > 0 ? conversation.checkpoints[0] : null;

    return {
      id: conversation.id,
      ownerId: conversation.ownerId,
      title: conversation.title,
      provider: conversation.provider,
      model: conversation.model,
      status: conversation.status,
      lastSequence: conversation.lastSequence,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages,
      checkpoints: conversation.checkpoints,
      activeCheckpoint: latestCheckpoint,
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
    const conv = await this.findOne(id, userId);
    const policy = getModelContextPolicy(conv.model);


    const activeCheckpoint = conv.activeCheckpoint;
    const isCompacted = !!activeCheckpoint;
    const compactedThrough = activeCheckpoint
      ? activeCheckpoint.compactedThroughSequence
      : 0;

    const assembledMessages: AssembledContextMessage[] = [];

    // 1. System prompt (if sequence 1 is system)
    const systemMsg = conv.messages.find(
      (m) => m.role === 'system' && m.sequenceNumber === 1,
    );
    if (systemMsg) {
      assembledMessages.push({
        role: 'system',
        content: systemMsg.content,
        source: 'system-instruction',
        sequenceNumber: 1,
        estimatedTokens: estimateTokens(systemMsg.content),
      });
    }

    // 2. Checkpoint summary & facts (if compacted)
    if (activeCheckpoint) {
      const factsList = Array.isArray(activeCheckpoint.retainedFacts)
        ? (activeCheckpoint.retainedFacts as string[])
        : [];

      const checkpointContent =
        `[CONVERSATION CHECKPOINT SUMMARY]\n${activeCheckpoint.summary}\n\n` +
        `[RETAINED FACTS & DECISIONS]\n` +
        (factsList.length > 0
          ? factsList.map((f) => `- ${f}`).join('\n')
          : '(No specific facts listed)');

      assembledMessages.push({
        role: 'system',
        content: checkpointContent,
        source: 'checkpoint-summary',
        sequenceNumber: activeCheckpoint.compactedThroughSequence,
        estimatedTokens: estimateTokens(checkpointContent),
      });
    }

    // 3. Retained uncompacted messages (messages with sequenceNumber > compactedThrough, skipping sequence 1 system msg)
    const uncompactedMessages = conv.messages.filter(
      (m) =>
        m.sequenceNumber > compactedThrough &&
        !(m.role === 'system' && m.sequenceNumber === 1),
    );

    for (const msg of uncompactedMessages) {
      assembledMessages.push({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
        source: 'retained-message',
        sequenceNumber: msg.sequenceNumber,
        estimatedTokens: estimateTokens(msg.content),
      });
    }

    // 4. Proposed current input (if provided)
    if (proposedInput && proposedInput.trim().length > 0) {
      assembledMessages.push({
        role: 'user',
        content: proposedInput.trim(),
        source: 'current-input',
        estimatedTokens: estimateTokens(proposedInput),
      });
    }

    const totalEstimatedTokens = assembledMessages.reduce(
      (sum, m) => sum + m.estimatedTokens,
      0,
    );

    const compactedCount = activeCheckpoint
      ? conv.messages.filter(
          (m) =>
            m.sequenceNumber <= activeCheckpoint.compactedThroughSequence &&
            !(m.role === 'system' && m.sequenceNumber === 1),
        ).length
      : 0;

    return {
      model: conv.model,
      provider: conv.provider,
      contextWindow: policy.contextWindow,
      contextLimitStatus: policy.status,
      inputBudget: policy.defaultInputBudget,
      reservedOutputTokens: policy.reservedOutputTokens,
      totalEstimatedInputTokens: totalEstimatedTokens,
      tokenUsageSource: 'estimated',
      isCompacted,
      activeCheckpoint: activeCheckpoint
        ? {
            id: activeCheckpoint.id,
            summary: activeCheckpoint.summary,
            retainedFacts: Array.isArray(activeCheckpoint.retainedFacts)
              ? (activeCheckpoint.retainedFacts as string[])
              : [],
            compactedThroughSequence: activeCheckpoint.compactedThroughSequence,
            createdAt: activeCheckpoint.createdAt,
          }
        : null,
      totalOriginalMessages: conv.messages.length,
      retainedMessagesCount: uncompactedMessages.length,
      compactedMessagesCount: compactedCount,
      assembledMessages,
      withinBudget: totalEstimatedTokens <= policy.defaultInputBudget,
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

    const conv = await this.findOne(id, userId);

    // 1. Build assembled context payload including proposed current input
    const inspection = await this.inspectContext(id, dto.content.trim(), userId);
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
    // If not both messages exist yet (in-flight persistence window), return 409 REQUEST_IN_PROGRESS.
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
      }

      throw new ConflictException('REQUEST_IN_PROGRESS');
    }

    if (!execution.success) {
      // Create user message if provider failed, allocating sequence number atomically
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
              inputTokens: estimateTokens(dto.content),
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
            inputTokens: estimateTokens(dto.content),
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
            inputTokens: execution.usage?.promptTokens || estimateTokens(dto.content),
            outputTokens: execution.usage?.completionTokens || estimateTokens(execution.content || ''),
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
      (m) => !(m.role === 'system' && m.sequenceNumber === 1),
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

    // Build transcript for summarization
    const transcript = messagesToCompact
      .map((m) => `[${m.role.toUpperCase()} (Seq ${m.sequenceNumber})]: ${m.content}`)
      .join('\n\n');

    const estimatedTokensBefore = messagesToCompact.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0,
    );

    // Call LLM for summarization
    const summarizationPrompt =
      `You are a specialized conversation summarizer performing context compaction.\n` +
      `Synthesize the following conversation transcript into:\n` +
      `1. A concise, comprehensive summary preserving key context, user requests, and assistant responses.\n` +
      `2. A list of important retained facts, decisions, constraints, or user preferences.\n\n` +
      `Format your output EXACTLY as:\n` +
      `SUMMARY:\n<summary paragraph>\n\n` +
      `FACTS:\n- <fact 1>\n- <fact 2>\n\n` +
      `TRANSCRIPT TO COMPACT:\n${transcript}`;

    let summaryText = '';
    let retainedFacts: string[] = [];

    const llmResult = await this.llmExecutionService.execute({
      userId: conv.ownerId,
      operation: 'compaction.preview',
      model: conv.model,
      provider: conv.provider,
      name: `Compaction Summarization (${conv.model})`,
      conversationId: conv.id,
      messages: [{ role: 'user', content: summarizationPrompt }],
      temperature: 0.3,
      maxTokens: 1024,
      metadata: { targetSeq },
      idempotencyKey,
    });

    if (llmResult.success && llmResult.content) {
      const content = llmResult.content;
      const summaryMatch = content.match(/SUMMARY:\s*([\s\S]*?)(?=FACTS:|$)/i);
      const factsMatch = content.match(/FACTS:\s*([\s\S]*)$/i);

      summaryText = summaryMatch ? summaryMatch[1].trim() : content.trim();
      if (factsMatch) {
        retainedFacts = factsMatch[1]
          .split('\n')
          .map((line) => line.replace(/^[-*•\d.]\s*/, '').trim())
          .filter((line) => line.length > 0);
      }
    } else {
      // Deterministic fallback if provider is unreachable/unauthenticated
      this.logger.warn(`Provider summarization failed (${llmResult.errorMessage}). Generating deterministic structural summary.`);
      
      const userQuestions = messagesToCompact
        .filter((m) => m.role === 'user')
        .map((m) => m.content.slice(0, 80));

      summaryText =
        `Discussion between user and assistant across messages ${messagesToCompact[0].sequenceNumber} through ${targetSeq}. ` +
        `Topics covered: ${userQuestions.join('; ')}.`;

      retainedFacts = userQuestions.map((q) => `User inquired about: "${q}"`);
    }

    if (retainedFacts.length === 0) {
      retainedFacts = [`Conversation context maintained through sequence ${targetSeq}.`];
    }

    const estimatedTokensAfter =
      estimateTokens(summaryText) +
      retainedFacts.reduce((sum, f) => sum + estimateTokens(f), 0);

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
    };
  }

  /**
   * Applies and persists a conversation compaction checkpoint.
   * Crucially, all original conversation messages remain stored in PostgreSQL.
   */
  async applyCompaction(id: string, dto: ApplyCompactionDto, userId: string) {
    const conv = await this.findOne(id, userId);

    if (!dto.summary || dto.summary.trim().length === 0) {
      throw new BadRequestException('Compaction summary cannot be empty.');
    }

    const maxSeq = conv.messages.reduce(
      (max, m) => Math.max(max, m.sequenceNumber),
      0,
    );

    if (dto.compactedThroughSequence > maxSeq) {
      throw new BadRequestException(
        `Cannot compact beyond latest message sequence (${maxSeq}).`,
      );
    }

    const checkpoint = await this.prisma.conversationCheckpoint.create({
      data: {
        conversationId: conv.id,
        summary: dto.summary.trim(),
        retainedFacts: (dto.retainedFacts || []) as unknown as Prisma.InputJsonValue,
        compactedThroughSequence: dto.compactedThroughSequence,
        contextPolicyVersion: 'v1',
      },
    });

    // Touch conversation updated timestamp
    await this.prisma.conversation.update({
      where: { id: conv.id },
      data: { updatedAt: new Date() },
    });

    const inspection = await this.inspectContext(conv.id, undefined, userId);


    return {
      success: true,
      checkpoint: {
        id: checkpoint.id,
        summary: checkpoint.summary,
        retainedFacts: dto.retainedFacts || [],
        compactedThroughSequence: checkpoint.compactedThroughSequence,
        createdAt: checkpoint.createdAt,
      },
      contextStatus: inspection,
    };
  }

  /**
   * Resumes conversation from a selected checkpoint.
   * Confirms active checkpoint and provides context inspection.
   */
  async resume(id: string, checkpointId: string | undefined, userId: string) {
    const conv = await this.findOne(id, userId);

    let targetCheckpoint = conv.activeCheckpoint;
    if (checkpointId) {
      const found = conv.checkpoints.find((c) => c.id === checkpointId);
      if (!found) {
        throw new NotFoundException(`Checkpoint with ID "${checkpointId}" was not found.`);
      }
      targetCheckpoint = found;
    }

    const inspection = await this.inspectContext(conv.id, undefined, userId);


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
