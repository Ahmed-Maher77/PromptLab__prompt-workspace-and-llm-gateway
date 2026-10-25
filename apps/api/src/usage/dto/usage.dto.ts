import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateQuotaPolicyDto {
  @IsOptional()
  @IsInt({ message: 'monthlyTokenLimit must be an integer' })
  @Min(1000, { message: 'monthlyTokenLimit must be at least 1000' })
  @Max(100000000, { message: 'monthlyTokenLimit must not exceed 100000000' })
  monthlyTokenLimit?: number;

  @IsOptional()
  @IsInt({ message: 'requestRateLimit must be an integer' })
  @Min(1, { message: 'requestRateLimit must be at least 1' })
  @Max(10000, { message: 'requestRateLimit must not exceed 10000' })
  requestRateLimit?: number;
}

export class ReserveUsageDto {
  requestId!: string;
  userId!: string;
  model!: string;
  provider!: string;
  estimatedTokens!: number;
  conversationId?: string;
}

export class ReconcileUsageDto {
  requestId!: string;
  userId?: string;
  success!: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    source: 'provider-reported' | 'estimated';
  };
  latencyMs?: number;
  error?: string;
  errorType?: 'TIMEOUT' | 'RATE_LIMITED' | 'AUTH_ERROR' | 'INVALID_REQUEST' | 'PROVIDER_ERROR' | string;
  responseBody?: any;
}
