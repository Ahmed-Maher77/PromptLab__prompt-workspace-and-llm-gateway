export class UpdateQuotaPolicyDto {
  monthlyTokenLimit?: number;
  requestRateLimit?: number;
}

export class ReserveUsageDto {
  requestId!: string;
  userId?: string;
  model!: string;
  provider!: string;
  estimatedTokens!: number;
  conversationId?: string;
}

export class ReconcileUsageDto {
  requestId!: string;
  success!: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    source: 'provider-reported' | 'estimated';
  };
  latencyMs?: number;
  error?: string;
}
