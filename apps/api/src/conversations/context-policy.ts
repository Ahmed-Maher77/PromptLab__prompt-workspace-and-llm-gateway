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

/**
 * Token count estimator.
 * Explicitly labeled as 'estimated'.
 * Uses a heuristic of ~3.8 characters per token for English text.
 */
export function estimateTokens(text: string): number {
  if (!text || text.trim().length === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 3.8));
}

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
  assembledMessages: AssembledContextMessage[];
  withinBudget: boolean;
}
