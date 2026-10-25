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
    currentMinuteRequests: number;
    remainingRequests: number;
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

export interface ReservationResult {
  success: boolean;
  requestId: string;
  reservedTokens: number;
  remainingTokens: number;
  periodId: string;
  created: boolean;
  record: any;
}
