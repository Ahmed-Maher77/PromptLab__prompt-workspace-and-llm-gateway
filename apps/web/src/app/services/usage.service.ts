import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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

export type UsageRecordStatus =
  | 'reserved'
  | 'reconciling'
  | 'reconciled'
  | 'failed'
  | 'timeout-ambiguous'
  | 'expired';

export type UsageOperation = 'playground' | 'comparison' | 'conversation' | 'compaction' | 'gateway';

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
  status: UsageRecordStatus;
  operation?: UsageOperation | null;
  createdAt: string;
  reconciledAt: string | null;
}

export interface QuotaPolicy {
  id: string;
  scope: string;
  scopeId: string;
  monthlyTokenLimit: number;
  requestRateLimit: number;
  effectiveFrom: string;
}

@Injectable({
  providedIn: 'root',
})
export class UsageService {
  private readonly baseUrl = '/api/usage';

  constructor(private readonly http: HttpClient) {}

  getStatus(): Observable<QuotaPeriodStatus> {
    return this.http.get<QuotaPeriodStatus>(`${this.baseUrl}/status`);
  }

  getLedger(limit = 100): Observable<UsageRecordItem[]> {
    return this.http.get<UsageRecordItem[]>(`${this.baseUrl}/ledger?limit=${limit}`);
  }

  getPolicy(): Observable<QuotaPolicy> {
    return this.http.get<QuotaPolicy>(`${this.baseUrl}/policy`);
  }

  updatePolicy(policy: { monthlyTokenLimit?: number; requestRateLimit?: number }): Observable<QuotaPolicy> {
    return this.http.put<QuotaPolicy>(`${this.baseUrl}/policy`, policy);
  }

  resetPeriodForDemo(): Observable<{ success: boolean; message: string; status: QuotaPeriodStatus }> {
    return this.http.post<{ success: boolean; message: string; status: QuotaPeriodStatus }>(
      `${this.baseUrl}/reset`,
      {},
    );
  }
}
