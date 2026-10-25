/**
 * Context window policies and token estimation utilities for Phase 3.
 */

export interface ModelContextPolicy {
  contextWindow: number | null;
  status: 'known' | 'unknown';
  defaultInputBudget: number;
  reservedOutputTokens: number;
  sourceNote?: string;
}

export const KNOWN_MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'gpt-4o-mini': 128_000,
  'gpt-4o': 128_000,
  'claude-3-5-sonnet': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-haiku': 200_000,
};

export function getModelContextPolicy(model: string): ModelContextPolicy {
  const normalized = model.toLowerCase();
  const limit = KNOWN_MODEL_CONTEXT_LIMITS[normalized];

  if (limit) {
    return {
      contextWindow: limit,
      status: 'known',
      // Safe default budget: 50% of context window or 8192 tokens max for POC
      defaultInputBudget: Math.min(Math.floor(limit * 0.5), 8192),
      reservedOutputTokens: 1024,
      sourceNote: 'Vendor published context window specification',
    };
  }

  return {
    contextWindow: null,
    status: 'unknown',
    defaultInputBudget: 4096,
    reservedOutputTokens: 1024,
    sourceNote: 'Context window metadata unavailable; do not imply exact limit',
  };
}

export function getMaxInputBudget(model: string): number {
  const policy = getModelContextPolicy(model);
  return policy.contextWindow !== null
    ? policy.contextWindow - policy.reservedOutputTokens
    : policy.defaultInputBudget;
}

import { estimateTokens } from '../common/utils/token-estimator';
export { estimateTokens };

export interface AssembledContextMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  source: 'system-instruction' | 'checkpoint-summary' | 'retained-message' | 'current-input';
  sequenceNumber?: number;
  estimatedTokens: number;
}

export interface ContextInspectionResult {
  model: string;
  provider: string;
  contextWindow: number | null;
  contextLimitStatus: 'known' | 'unknown';
  requestedBudget: number | null;
  inputBudget: number;
  reservedOutputTokens: number;
  totalEstimatedInputTokens: number;
  tokenUsageSource: 'estimated';
  isCompacted: boolean;
  activeCheckpoint: {
    id: string;
    summary: string;
    retainedFacts: string[];
    compactedThroughSequence: number;
    createdAt: Date;
  } | null;
  totalOriginalMessages: number;
  retainedMessagesCount: number;
  compactedMessagesCount: number;
  truncatedMessagesCount: number;
  assembledMessages: AssembledContextMessage[];
  withinBudget: boolean;
  essentialTokensExceeded?: boolean;
}

export interface AssembleContextConversationInput {
  model: string;
  provider: string;
  contextBudget?: number | null;
  activeCheckpointId?: string | null;
  messages: Array<{
    id?: string;
    role: string;
    content: string;
    sequenceNumber: number;
    status?: string | null;
    createdAt?: Date | string;
  }>;
  checkpoints?: Array<{
    id: string;
    summary: string;
    retainedFacts: unknown;
    compactedThroughSequence: number;
    createdAt: Date | string;
  }>;
  activeCheckpoint?: {
    id: string;
    summary: string;
    retainedFacts: unknown;
    compactedThroughSequence: number;
    createdAt: Date | string;
  } | null;
}

/**
 * Shared context assembly and sliding window truncation algorithm (CONV-03).
 *
 * Rules:
 * 1. Pinned System Instruction (seq 1, status != 'failed') is NEVER dropped.
 * 2. Pinned Active Checkpoint summary & facts are NEVER dropped.
 * 3. Pinned Proposed / New user message is NEVER dropped.
 * 4. CONV-03a: effectiveBudget = min(requested, maxInputBudget), where maxInputBudget =
 *    contextWindow - reservedOutputTokens for known models, or defaultInputBudget for unknown models.
 * 5. If total tokens exceed effectiveBudget, a sliding window drops the oldest
 *    retained non-failed messages until within budget.
 * 6. CONV-03b: Dialogue must never begin with an orphaned assistant reply. If pruning
 *    drops a user turn, continued pruning drops the orphaned assistant reply (whole turns).
 * 7. If essential pinned tokens alone exceed budget, essentialTokensExceeded = true
 *    and withinBudget = false.
 */
export function assembleConversationContext(
  conv: AssembleContextConversationInput,
  proposedInput?: string,
): ContextInspectionResult {
  const policy = getModelContextPolicy(conv.model);
  const maxInputBudget = getMaxInputBudget(conv.model);

  const requestedBudget =
    typeof conv.contextBudget === 'number' && conv.contextBudget > 0
      ? conv.contextBudget
      : null;

  const effectiveBudget =
    requestedBudget !== null
      ? Math.min(requestedBudget, maxInputBudget)
      : policy.defaultInputBudget;

  const activeCheckpoint =
    conv.activeCheckpoint !== undefined
      ? conv.activeCheckpoint
      : conv.activeCheckpointId
        ? conv.checkpoints?.find((c) => c.id === conv.activeCheckpointId) || null
        : conv.checkpoints && conv.checkpoints.length > 0
          ? conv.checkpoints[0]
          : null;

  const isCompacted = !!activeCheckpoint;
  const compactedThrough = activeCheckpoint
    ? activeCheckpoint.compactedThroughSequence
    : 0;

  // 1. Pinned System Instruction
  const systemMsg = conv.messages.find(
    (m) =>
      m.role === 'system' &&
      m.sequenceNumber === 1 &&
      m.status !== 'failed',
  );
  let systemMessage: AssembledContextMessage | null = null;
  if (systemMsg) {
    systemMessage = {
      role: 'system',
      content: systemMsg.content,
      source: 'system-instruction',
      sequenceNumber: 1,
      estimatedTokens: estimateTokens(systemMsg.content),
    };
  }

  // 2. Pinned Active Checkpoint Summary & Facts
  let checkpointMessage: AssembledContextMessage | null = null;
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

    checkpointMessage = {
      role: 'system',
      content: checkpointContent,
      source: 'checkpoint-summary',
      sequenceNumber: activeCheckpoint.compactedThroughSequence,
      estimatedTokens: estimateTokens(checkpointContent),
    };
  }

  // 3. Pinned Proposed / New Input
  let proposedMessage: AssembledContextMessage | null = null;
  if (proposedInput && proposedInput.trim().length > 0) {
    proposedMessage = {
      role: 'user',
      content: proposedInput.trim(),
      source: 'current-input',
      estimatedTokens: estimateTokens(proposedInput),
    };
  }

  const essentialTokens =
    (systemMessage ? systemMessage.estimatedTokens : 0) +
    (checkpointMessage ? checkpointMessage.estimatedTokens : 0) +
    (proposedMessage ? proposedMessage.estimatedTokens : 0);

  // 4. Retained uncompacted dialogue messages
  const uncompactedMessages = conv.messages
    .filter(
      (m) =>
        m.sequenceNumber > compactedThrough &&
        !(m.role === 'system' && m.sequenceNumber === 1) &&
        m.status !== 'failed',
    )
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  const retainedAssembled: AssembledContextMessage[] = uncompactedMessages.map(
    (msg) => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content,
      source: 'retained-message' as const,
      sequenceNumber: msg.sequenceNumber,
      estimatedTokens: estimateTokens(msg.content),
    }),
  );

  const retainedTokensTotal = retainedAssembled.reduce(
    (sum, m) => sum + m.estimatedTokens,
    0,
  );

  let survivingRetained: AssembledContextMessage[] = [];
  let truncatedMessagesCount = 0;
  let essentialTokensExceeded = false;

  if (essentialTokens > effectiveBudget) {
    essentialTokensExceeded = true;
    truncatedMessagesCount = retainedAssembled.length;
    survivingRetained = [];
  } else {
    let currentTotal = essentialTokens + retainedTokensTotal;
    let dropIndex = 0;
    while (
      dropIndex < retainedAssembled.length &&
      currentTotal > effectiveBudget
    ) {
      currentTotal -= retainedAssembled[dropIndex].estimatedTokens;
      dropIndex++;
    }

    // CONV-03b: never start dialogue with an orphaned assistant reply.
    // If messages were dropped and the first surviving retained message is an assistant message,
    // continue dropping while the first surviving retained message is not role 'user' (whole turns only).
    while (
      dropIndex < retainedAssembled.length &&
      retainedAssembled[dropIndex].role !== 'user'
    ) {
      currentTotal -= retainedAssembled[dropIndex].estimatedTokens;
      dropIndex++;
    }

    truncatedMessagesCount = dropIndex;
    survivingRetained = retainedAssembled.slice(dropIndex);
  }

  const assembledMessages: AssembledContextMessage[] = [];
  if (systemMessage) assembledMessages.push(systemMessage);
  if (checkpointMessage) assembledMessages.push(checkpointMessage);
  for (const m of survivingRetained) {
    assembledMessages.push(m);
  }
  if (proposedMessage) assembledMessages.push(proposedMessage);

  const totalEstimatedInputTokens = assembledMessages.reduce(
    (sum, m) => sum + m.estimatedTokens,
    0,
  );

  const compactedCount = activeCheckpoint
    ? conv.messages.filter(
        (m) =>
          m.sequenceNumber <= activeCheckpoint.compactedThroughSequence &&
          !(m.role === 'system' && m.sequenceNumber === 1) &&
          m.status !== 'failed',
      ).length
    : 0;

  return {
    model: conv.model,
    provider: conv.provider,
    contextWindow: policy.contextWindow,
    contextLimitStatus: policy.status,
    requestedBudget,
    inputBudget: effectiveBudget,
    reservedOutputTokens: policy.reservedOutputTokens,
    totalEstimatedInputTokens,
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
          createdAt: new Date(activeCheckpoint.createdAt),
        }
      : null,
    totalOriginalMessages: conv.messages.length,
    retainedMessagesCount: survivingRetained.length,
    compactedMessagesCount: compactedCount,
    truncatedMessagesCount,
    assembledMessages,
    withinBudget: !essentialTokensExceeded && totalEstimatedInputTokens <= effectiveBudget,
    essentialTokensExceeded,
  };
}
