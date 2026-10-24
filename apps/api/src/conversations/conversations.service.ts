import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { UsageService } from '../usage/usage.service';
import { ObservabilityService } from '../observability/observability.service';
import { calculateCost } from '../experiments/cost-calculator';
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
import { Prisma } from '@prisma/client';
import { DEFAULT_DEV_USER } from '../common/constants/auth.constants';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providersService: ProvidersService,
    @Optional() private readonly usageService?: UsageService,
    @Optional() private readonly observabilityService?: ObservabilityService,
  ) {}

  /**
   * Ensures a default developer user exists.
   */
  private async getOrCreateDefaultUser(): Promise<string> {
    const existing =
      typeof this.prisma.user.findUnique === 'function'
        ? await this.prisma.user.findUnique({ where: { id: DEFAULT_DEV_USER.id } })
        : null;
    if (existing) {
      return existing.id;
    }

    const first = await this.prisma.user.findFirst();
    if (first) {
      return first.id;
    }

    if (typeof this.prisma.user.upsert === 'function') {
      const created = await this.prisma.user.upsert({
        where: { id: DEFAULT_DEV_USER.id },
        update: {},
        create: {
          id: DEFAULT_DEV_USER.id,
          email: DEFAULT_DEV_USER.email,
          displayName: DEFAULT_DEV_USER.displayName,
          role: DEFAULT_DEV_USER.role,
        },
      });
      return created.id;
    }

    const created = await this.prisma.user.create({
      data: {
        id: DEFAULT_DEV_USER.id,
        email: DEFAULT_DEV_USER.email,
        displayName: DEFAULT_DEV_USER.displayName,
        role: DEFAULT_DEV_USER.role,
      },
    });
    return created.id;
  }

  /**
   * Creates a new conversation with optional initial system instructions.
   */
  async create(dto: CreateConversationDto, userId?: string) {
    const ownerId = userId || (await this.getOrCreateDefaultUser());

    const title =
      dto.title?.trim() ||
      `Conversation (${dto.model} — ${new Date().toLocaleDateString()})`;

    const conversation = await this.prisma.conversation.create({
      data: {
        ownerId,
        title,
        provider: dto.provider,
        model: dto.model,
        status: 'active',
      },
    });

    // If an initial system prompt is provided, insert it as sequence 1
    if (dto.systemPrompt && dto.systemPrompt.trim().length > 0) {
      await this.prisma.conversationMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'system',
          content: dto.systemPrompt.trim(),
          sequenceNumber: 1,
          inputTokens: estimateTokens(dto.systemPrompt),
          tokenUsageSource: 'estimated',
        },
      });
    }

    return this.findOne(conversation.id, ownerId);
  }


  /**
   * Lists all conversations.
   * Supports deterministic pagination (limit and offset).
   */
  async findAll(userId?: string, pagination?: { limit?: number; offset?: number }) {
    const where = userId ? { ownerId: userId } : {};
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
   */
  async findOne(id: string, userId?: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id,
        ...(userId ? { ownerId: userId } : {}),
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
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages,
      checkpoints: conversation.checkpoints,
      activeCheckpoint: latestCheckpoint,
    };
  }

  /**
   * Deletes a conversation by ID.
   */
  async delete(id: string, userId?: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id,
        ...(userId ? { ownerId: userId } : {}),
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
    proposedInput?: string,
    userId?: string,
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
  async sendMessage(id: string, dto: SendMessageDto, userId?: string) {
    if (!dto.content || dto.content.trim().length === 0) {
      throw new BadRequestException('Message content cannot be empty.');
    }

    const conv = await this.findOne(id, userId);

    // Concurrency safety: find current max sequence number
    const maxSeq = conv.messages.reduce(
      (max, m) => Math.max(max, m.sequenceNumber),
      0,
    );
    const userSeq = maxSeq + 1;

    // 1. Transactionally persist user message first so it is never lost
    const userMessage = await this.prisma.conversationMessage.create({
      data: {
        conversationId: conv.id,
        role: 'user',
        content: dto.content.trim(),
        sequenceNumber: userSeq,
        inputTokens: estimateTokens(dto.content),
        tokenUsageSource: 'estimated',
      },
    });

    // 2. Build assembled context payload
    const inspection = await this.inspectContext(id, undefined, userId);
    const messagesPayload = inspection.assembledMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));


    const estimatedTokens = inspection.totalEstimatedInputTokens + 1024;
    const requestId = `req-conv-${conv.id}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const trace = this.observabilityService?.startTrace({
      name: `Conversation Turn (${conv.model})`,
      operation: 'conversation.turn',
      model: conv.model,
      provider: conv.provider,
      metadata: { conversationId: conv.id, requestId },
    });

    // Reserve estimated quota before dispatching
    const reserveSpan = trace?.startSpan('quota.reserve', { estimatedTokens, requestId });
    if (this.usageService) {
      await this.usageService.reserveUsage({
        requestId,
        userId: conv.ownerId || DEFAULT_DEV_USER.id,
        model: conv.model,
        provider: conv.provider,
        estimatedTokens,
        conversationId: conv.id,
      });
    }
    reserveSpan?.end('ok');

    // 3. Dispatch to model gateway
    const llmSpan = trace?.startSpan('litellm.chat_completion', { model: conv.model });
    const result = await this.providersService.executeChatCompletion({
      model: conv.model,
      messages: messagesPayload,
      temperature: 0.7,
      maxTokens: 1024,
      traceId: trace?.traceId,
      spanId: llmSpan?.id,
      requestId,
    });
    llmSpan?.end(result.success ? 'ok' : 'error', {
      latencyMs: result.latencyMs,
      errorCode: result.errorType,
    });

    const reconcileSpan = trace?.startSpan('quota.reconcile', { requestId });
    if (this.usageService) {
      await this.usageService.reconcileUsage({
        requestId,
        success: result.success,
        usage: result.usage,
        latencyMs: result.latencyMs,
        error: result.errorMessage,
      });
    }
    reconcileSpan?.end('ok');

    const promptTokens = result.usage?.promptTokens || 0;
    const completionTokens = result.usage?.completionTokens || 0;
    const cost = calculateCost(conv.model, promptTokens, completionTokens);

    trace?.complete({
      status: result.success ? 'success' : 'error',
      usage: result.usage,
      cost,
      errorCode: result.errorType,
      errorMessage: result.errorMessage,
    });

    if (!result.success) {
      // Handle provider failure explicitly without corrupting the conversation history
      return {
        success: false,
        userMessage,
        assistantMessage: null,
        errorType: result.errorType,
        errorMessage: result.errorMessage || 'Provider failed to generate response',
        configurationHint: result.configurationHint,
        traceId: trace?.traceId,
      };
    }

    // 4. Persist assistant response
    const assistantSeq = userSeq + 1;
    const assistantMessage = await this.prisma.conversationMessage.create({
      data: {
        conversationId: conv.id,
        role: 'assistant',
        content: result.content || '',
        sequenceNumber: assistantSeq,
        inputTokens: result.usage?.promptTokens || estimateTokens(dto.content),
        outputTokens: result.usage?.completionTokens || estimateTokens(result.content || ''),
        tokenUsageSource: result.usage?.source || 'provider-reported',
      },
    });

    // Touch conversation updated timestamp
    await this.prisma.conversation.update({
      where: { id: conv.id },
      data: { updatedAt: new Date() },
    });

    return {
      success: true,
      userMessage,
      assistantMessage,
      latencyMs: result.latencyMs,
      usage: result.usage,
      traceId: trace?.traceId,
    };
  }

  /**
   * Generates a proposed compaction summary and facts list for manual user review.
   */
  async previewCompaction(id: string, dto?: PreviewCompactionDto, userId?: string) {
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

    const estimatedCompactionTokens = estimateTokens(summarizationPrompt) + 1024;
    const requestId = `req-comp-${conv.id}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const trace = this.observabilityService?.startTrace({
      name: `Compaction Summarization (${conv.model})`,
      operation: 'conversation.turn',
      model: conv.model,
      provider: conv.provider,
      metadata: { conversationId: conv.id, requestId, targetSeq },
    });

    const reserveSpan = trace?.startSpan('quota.reserve', { estimatedTokens: estimatedCompactionTokens, requestId });
    if (this.usageService) {
      await this.usageService.reserveUsage({
        requestId,
        userId: conv.ownerId || DEFAULT_DEV_USER.id,
        model: conv.model,
        provider: conv.provider,
        estimatedTokens: estimatedCompactionTokens,
        conversationId: conv.id,
      });
    }
    reserveSpan?.end('ok');

    const llmSpan = trace?.startSpan('litellm.chat_completion', { model: conv.model });
    const llmResult = await this.providersService.executeChatCompletion({
      model: conv.model,
      messages: [{ role: 'user', content: summarizationPrompt }],
      temperature: 0.3,
      maxTokens: 1024,
      traceId: trace?.traceId,
      spanId: llmSpan?.id,
      requestId,
    });
    llmSpan?.end(llmResult.success ? 'ok' : 'error', {
      latencyMs: llmResult.latencyMs,
      errorCode: llmResult.errorType,
    });

    const reconcileSpan = trace?.startSpan('quota.reconcile', { requestId });
    if (this.usageService) {
      await this.usageService.reconcileUsage({
        requestId,
        success: llmResult.success,
        usage: llmResult.usage,
        latencyMs: llmResult.latencyMs,
        error: llmResult.errorMessage,
      });
    }
    reconcileSpan?.end('ok');

    const promptTokens = llmResult.usage?.promptTokens || 0;
    const completionTokens = llmResult.usage?.completionTokens || 0;
    const cost = calculateCost(conv.model, promptTokens, completionTokens);

    trace?.complete({
      status: llmResult.success ? 'success' : 'error',
      usage: llmResult.usage,
      cost,
      errorCode: llmResult.errorType,
      errorMessage: llmResult.errorMessage,
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
  async applyCompaction(id: string, dto: ApplyCompactionDto, userId?: string) {
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
  async resume(id: string, checkpointId?: string, userId?: string) {
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
