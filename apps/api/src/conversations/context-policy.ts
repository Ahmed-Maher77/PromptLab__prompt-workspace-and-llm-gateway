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

export interface ModelCatalogEntryLike {
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  provider?: string;
  isUnknownDefault?: boolean;
}

export const DEFAULT_UNKNOWN_CONTEXT_POLICY: ModelContextPolicy = Object.freeze({
  contextWindow: null,
  status: 'unknown',
  defaultInputBudget: 4096,
  reservedOutputTokens: 1024,
  sourceNote: 'Context window metadata unavailable from gateway catalog; conservative default applied',
});

export function getModelContextPolicy(
  entry?: ModelCatalogEntryLike | null,
): ModelContextPolicy {
  if (entry && !entry.isUnknownDefault && typeof entry.maxInputTokens === 'number') {
    const window = entry.maxInputTokens;
    const reserved = entry.maxOutputTokens ?? 1024;
    return {
      contextWindow: window,
      status: 'known',
      defaultInputBudget: Math.min(Math.floor(window * 0.5), 8192),
      reservedOutputTokens: reserved,
      sourceNote: `Gateway model catalog specification (${entry.provider || 'gateway'})`,
    };
  }

  return {
    contextWindow: null,
    status: 'unknown',
    defaultInputBudget: 4096,
    reservedOutputTokens: entry?.maxOutputTokens ?? 1024,
    sourceNote: 'Context window metadata unavailable from gateway catalog; conservative default applied',
  };
}

export function getMaxInputBudget(
  input?: ModelContextPolicy | ModelCatalogEntryLike | null,
): number {
  const policy =
    input && typeof input === 'object' && 'contextWindow' in input && 'defaultInputBudget' in input
      ? (input as ModelContextPolicy)
      : getModelContextPolicy(input as ModelCatalogEntryLike | null | undefined);

  return policy.contextWindow !== null
    ? policy.contextWindow - policy.reservedOutputTokens
    : policy.defaultInputBudget;
}


import { estimateTokens } from '../common/utils/token-estimator';
import { TokenEstimationMethod } from '../tokens/tokens.types';
export { estimateTokens };
export type { TokenEstimationMethod };

export type ContextTokenCounter = (
  text: string,
) => { tokens: number; method?: TokenEstimationMethod } | number;

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
  tokenEstimationMethod?: TokenEstimationMethod;
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
  /**
   * Optional counts for callers that load only the messages after the active checkpoint.
   * When omitted they are derived from `messages`.
   */
  totalMessageCount?: number;
  compactedMessageCount?: number;
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
 * Shared context assembly and sliding window truncation algorithm.
 *
 * Rules:
 * 1. Pinned System Instruction (seq 1, status != 'failed') is NEVER dropped.
 * 2. Pinned Active Checkpoint summary & facts are NEVER dropped.
 * 3. Pinned Proposed / New user message is NEVER dropped.
 * 4. effectiveBudget = min(requested, maxInputBudget), where maxInputBudget =
 *    contextWindow - reservedOutputTokens for known models, or defaultInputBudget for unknown models.
 * 5. If total tokens exceed effectiveBudget, a sliding window drops the oldest
 *    retained non-failed messages until within budget.
 * 6. Dialogue must never begin with an orphaned assistant reply. If pruning
 *    drops a user turn, continued pruning drops the orphaned assistant reply (whole turns).
 * 7. If essential pinned tokens alone exceed budget, essentialTokensExceeded = true
 *    and withinBudget = false.
 */
export function assembleConversationContext(
  conv: AssembleContextConversationInput,
  proposedInput?: string,
  policy?: ModelContextPolicy,
  tokenCounter?: ContextTokenCounter,
): ContextInspectionResult {
  const effectivePolicy = policy ?? getModelContextPolicy();
  const maxInputBudget = getMaxInputBudget(effectivePolicy);

  let estimationMethod: TokenEstimationMethod | undefined;
  const count = (text: string | null | undefined): number => {
    if (!text) return 0;
    if (!tokenCounter) {
      return estimateTokens(text);
    }
    const res = tokenCounter(text);
    if (typeof res === 'number') {
      return res;
    }
    if (res.method && !estimationMethod) {
      estimationMethod = res.method;
    }
    return res.tokens;
  };

  const requestedBudget =
    typeof conv.contextBudget === 'number' && conv.contextBudget > 0
      ? conv.contextBudget
      : null;

  const effectiveBudget =
    requestedBudget !== null
      ? Math.min(requestedBudget, maxInputBudget)
      : effectivePolicy.defaultInputBudget;

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
      estimatedTokens: count(systemMsg.content),
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
      estimatedTokens: count(checkpointContent),
    };
  }

  // 3. Pinned Proposed / New Input
  let proposedMessage: AssembledContextMessage | null = null;
  if (proposedInput && proposedInput.trim().length > 0) {
    proposedMessage = {
      role: 'user',
      content: proposedInput.trim(),
      source: 'current-input',
      estimatedTokens: count(proposedInput),
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
      estimatedTokens: count(msg.content),
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

    // Never start dialogue with an orphaned assistant reply.
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

  const compactedCount = !activeCheckpoint
    ? 0
    : conv.compactedMessageCount !== undefined
      ? conv.compactedMessageCount
      : conv.messages.filter(
        (m) =>
          m.sequenceNumber <= activeCheckpoint.compactedThroughSequence &&
          !(m.role === 'system' && m.sequenceNumber === 1) &&
          m.status !== 'failed',
      ).length;

  return {
    model: conv.model,
    provider: conv.provider,
    contextWindow: effectivePolicy.contextWindow,
    contextLimitStatus: effectivePolicy.status,
    requestedBudget,
    inputBudget: effectiveBudget,
    reservedOutputTokens: effectivePolicy.reservedOutputTokens,
    totalEstimatedInputTokens,
    tokenUsageSource: 'estimated',
    tokenEstimationMethod: estimationMethod ?? 'heuristic:chars/4',
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
    totalOriginalMessages: conv.totalMessageCount ?? conv.messages.length,
    retainedMessagesCount: survivingRetained.length,
    compactedMessagesCount: compactedCount,
    truncatedMessagesCount,
    assembledMessages,
    withinBudget: !essentialTokensExceeded && totalEstimatedInputTokens <= effectiveBudget,
    essentialTokensExceeded,
  };
}
