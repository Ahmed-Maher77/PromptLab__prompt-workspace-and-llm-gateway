import { TokenUsageSource, UsageOperation, UsageStatus } from '@prisma/client';

/**
 * Boundary between the database enums (identifier-safe names) and the public API strings.
 * The API and stored response bodies keep the hyphenated values they have always used.
 */

export type ApiUsageStatus =
  | 'reserved'
  | 'reconciling'
  | 'reconciled'
  | 'failed'
  | 'timeout-ambiguous'
  | 'expired';

export type ApiTokenUsageSource = 'estimated' | 'provider-reported' | 'estimated-timeout';

export type ApiUsageOperation = 'playground' | 'comparison' | 'conversation' | 'compaction' | 'gateway';

const USAGE_STATUS_TO_API: Record<UsageStatus, ApiUsageStatus> = {
  reserved: 'reserved',
  reconciling: 'reconciling',
  reconciled: 'reconciled',
  failed: 'failed',
  timeout_ambiguous: 'timeout-ambiguous',
  expired: 'expired',
};

const TOKEN_SOURCE_TO_API: Record<TokenUsageSource, ApiTokenUsageSource> = {
  estimated: 'estimated',
  provider_reported: 'provider-reported',
  estimated_timeout: 'estimated-timeout',
};

function invert<K extends string, V extends string>(map: Record<K, V>): Record<V, K> {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k])) as Record<V, K>;
}

const USAGE_STATUS_FROM_API = invert(USAGE_STATUS_TO_API);
const TOKEN_SOURCE_FROM_API = invert(TOKEN_SOURCE_TO_API);

export function toApiUsageStatus(status: UsageStatus): ApiUsageStatus {
  return USAGE_STATUS_TO_API[status];
}

export function fromApiUsageStatus(status: string): UsageStatus {
  const value = (USAGE_STATUS_FROM_API as Record<string, UsageStatus | undefined>)[status];
  if (!value) {
    throw new Error(`Unknown usage status "${status}"`);
  }
  return value;
}

export function toApiTokenUsageSource(source: TokenUsageSource): ApiTokenUsageSource {
  return TOKEN_SOURCE_TO_API[source];
}

export function fromApiTokenUsageSource(source: string): TokenUsageSource {
  const value = (TOKEN_SOURCE_FROM_API as Record<string, TokenUsageSource | undefined>)[source];
  if (!value) {
    throw new Error(`Unknown token usage source "${source}"`);
  }
  return value;
}

const OPERATION_TO_USAGE_OPERATION: Record<string, UsageOperation> = {
  'playground.execute': 'playground',
  'comparison.slot': 'comparison',
  'conversation.turn': 'conversation',
  'compaction.preview': 'compaction',
  'gateway.request': 'gateway',
};

/** Maps an execution pipeline operation name to the persisted usage operation. */
export function toUsageOperation(operation: string): UsageOperation {
  const value = OPERATION_TO_USAGE_OPERATION[operation];
  if (!value) {
    throw new Error(`Unknown LLM operation "${operation}"`);
  }
  return value;
}
