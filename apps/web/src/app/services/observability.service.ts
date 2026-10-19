import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface TraceSpan {
  id: string;
  parentSpanId?: string;
  name: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  status: 'ok' | 'error';
  attributes: Record<string, unknown>;
}

export interface TraceRecord {
  id: string;
  name: string;
  operation: 'playground.execute' | 'comparison.slot' | 'conversation.turn' | 'gateway.request';
  status: 'success' | 'error' | 'rate_limited';
  startTime: string;
  endTime: string;
  durationMs: number;
  model: string;
  provider: string;
  userId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenUsageSource: string;
  estimatedCost: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  spans: TraceSpan[];
}

export interface ObservabilityStatus {
  telemetryEnabled: boolean;
  otelConfigured: boolean;
  otelEndpoint: string | null;
  langfuseConfigured: boolean;
  langfuseHost: string | null;
  totalTracesRecorded: number;
  privacyRedactionActive: boolean;
  supportedTracedOperations: string[];
}

@Injectable({
  providedIn: 'root',
})
export class ObservabilityService {
  private readonly baseUrl = '/api/observability';

  constructor(private readonly http: HttpClient) {}

  getStatus(): Observable<ObservabilityStatus> {
    return this.http.get<ObservabilityStatus>(`${this.baseUrl}/status`);
  }

  getTraces(filters?: {
    status?: string;
    model?: string;
    operation?: string;
    limit?: number;
  }): Observable<TraceRecord[]> {
    let params = new HttpParams();
    if (filters?.status) params = params.set('status', filters.status);
    if (filters?.model) params = params.set('model', filters.model);
    if (filters?.operation) params = params.set('operation', filters.operation);
    if (filters?.limit) params = params.set('limit', filters.limit.toString());

    return this.http.get<TraceRecord[]>(`${this.baseUrl}/traces`, { params });
  }

  getTrace(traceId: string): Observable<TraceRecord> {
    return this.http.get<TraceRecord>(`${this.baseUrl}/traces/${traceId}`);
  }

  clearTraces(): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(`${this.baseUrl}/clear`, {});
  }
}
