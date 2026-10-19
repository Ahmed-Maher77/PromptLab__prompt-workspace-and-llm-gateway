export interface SpanEvent {
  name: string;
  timestamp: string;
  attributes?: Record<string, unknown>;
}

export interface TraceSpan {
  id: string;
  name: string;
  parentSpanId?: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  status: 'ok' | 'error';
  attributes: Record<string, unknown>;
  events?: SpanEvent[];
}

export interface TraceRecord {
  id: string; // 32-char hex traceId
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
