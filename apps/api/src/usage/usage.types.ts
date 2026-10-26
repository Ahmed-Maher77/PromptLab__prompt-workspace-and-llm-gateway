export interface QuotaPeriodStatus {
  userId: string;
  periodId: string;
  periodStart: string;
  periodEnd: string;
  resetDate: string;
  tokenLimit: number;
  actualTokens: number;
  reservedTokens: number;
  remainingTokens: number;
  percentUsed: number;
  percentReserved: number;
  status: string;
  rateLimit: {
    limitPerMinute: number;
  };
  estimatedTotalCost: number;
}

export interface UsageRecordItem {
  id: string;
  requestId: string;
  userId: string;
  conversationId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenUsageSource: string;
  reservedTokens: number;
  estimatedCost: number | null;
  status: string;
  createdAt: Date;
  reconciledAt: Date | null;
}

import { UsageRecord } from '@prisma/client';

export interface StoredLlmResponse {
  success: boolean;
  content: string;
  model: string;
  latencyMs: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    source: 'provider-reported' | 'estimated';
  };
  cost?: number | null;
  traceId?: string;
  requestId?: string;
  error?: string;
  errorType?: string;
}

export interface ReservationResult {
  success: boolean;
  requestId: string;
  reservedTokens: number;
  remainingTokens: number;
  periodId: string;
  created: boolean;
  record: UsageRecord | null;
}

