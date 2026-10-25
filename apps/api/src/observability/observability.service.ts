import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUTH_CONFIG, ValidatedEnvironment } from '../common/config/env.validation';
import {
  TraceRecord,
  TraceSpan,
  ObservabilityStatus,
} from './observability.types';
import {
  sanitizeTelemetry,
  generateTraceId,
  generateSpanId,
} from './redaction.util';

export interface ActiveSpan {
  id: string;
  name: string;
  startTime: Date;
  end: (status?: 'ok' | 'error', attributes?: Record<string, unknown>) => void;
}

export interface ActiveTraceContext {
  traceId: string;
  rootSpanId: string;
  traceparent: string;
  startSpan: (name: string, attributes?: Record<string, unknown>) => ActiveSpan;
  complete: (params: {
    status: 'success' | 'error' | 'rate_limited';
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      source: string;
    };
    cost?: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  }) => TraceRecord;
}

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name);

  // In-memory ring buffer of recent traces for developer inspection
  private readonly traceBuffer: TraceRecord[] = [];
  private readonly maxBufferSize = 500;

  constructor(
    @Inject(AUTH_CONFIG) private readonly authConfig: ValidatedEnvironment,
    private readonly configService: ConfigService,
  ) {}

  isTelemetryEnabled(): boolean {
    return this.authConfig.ENABLE_TELEMETRY;
  }

  getOtelEndpoint(): string | null {
    return this.configService.get<string>('OTEL_EXPORTER_OTLP_ENDPOINT') || null;
  }

  getLangfuseConfig(): { publicKey: string | null; secretKey: string | null; baseUrl: string } {
    return {
      publicKey: this.configService.get<string>('LANGFUSE_PUBLIC_KEY') || null,
      secretKey: this.configService.get<string>('LANGFUSE_SECRET_KEY') || null,
      baseUrl:
        this.authConfig.LANGFUSE_BASEURL ||
        this.authConfig.LANGFUSE_HOST ||
        'http://localhost:3000',
    };
  }

  /**
   * Starts an active trace context for an LLM operation.
   * Generates W3C TraceContext headers and span collectors.
   */
  startTrace(params: {
    name: string;
    operation: 'playground.execute' | 'comparison.slot' | 'conversation.turn' | 'compaction.preview' | 'gateway.request';
    model: string;
    provider: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }): ActiveTraceContext {
    const traceId = generateTraceId();
    const rootSpanId = generateSpanId();
    const traceparent = `00-${traceId}-${rootSpanId}-01`;
    const traceStartTime = new Date();
    const spans: TraceSpan[] = [];

    // Root span created automatically
    const rootSpan: TraceSpan = {
      id: rootSpanId,
      name: params.name,
      startTime: traceStartTime.toISOString(),
      endTime: '',
      durationMs: 0,
      status: 'ok',
      attributes: {
        'llm.model': params.model,
        'llm.provider': params.provider,
        'operation.name': params.operation,
        ...(params.metadata || {}),
      },
    };
    spans.push(rootSpan);

    const startSpan = (name: string, attributes?: Record<string, unknown>): ActiveSpan => {
      const spanId = generateSpanId();
      const spanStart = new Date();
      const span: TraceSpan = {
        id: spanId,
        parentSpanId: rootSpanId,
        name,
        startTime: spanStart.toISOString(),
        endTime: '',
        durationMs: 0,
        status: 'ok',
        attributes: attributes || {},
      };
      spans.push(span);

      return {
        id: spanId,
        name,
        startTime: spanStart,
        end: (status = 'ok', endAttributes = {}) => {
          const spanEnd = new Date();
          span.endTime = spanEnd.toISOString();
          span.durationMs = spanEnd.getTime() - spanStart.getTime();
          span.status = status;
          span.attributes = { ...span.attributes, ...endAttributes };
        },
      };
    };

    const complete = (completeParams: {
      status: 'success' | 'error' | 'rate_limited';
      usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        source: string;
      };
      cost?: number | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      metadata?: Record<string, unknown>;
    }): TraceRecord => {
      const traceEndTime = new Date();
      const durationMs = traceEndTime.getTime() - traceStartTime.getTime();

      rootSpan.endTime = traceEndTime.toISOString();
      rootSpan.durationMs = durationMs;
      rootSpan.status = completeParams.status === 'success' ? 'ok' : 'error';

      const record: TraceRecord = {
        id: traceId,
        name: params.name,
        operation: params.operation,
        status: completeParams.status,
        startTime: traceStartTime.toISOString(),
        endTime: traceEndTime.toISOString(),
        durationMs,
        model: params.model,
        provider: params.provider,
        userId: params.userId || 'dev-user-001',
        inputTokens: completeParams.usage?.promptTokens || 0,
        outputTokens: completeParams.usage?.completionTokens || 0,
        totalTokens: completeParams.usage?.totalTokens || 0,
        tokenUsageSource: completeParams.usage?.source || 'estimated',
        estimatedCost: completeParams.cost ?? null,
        errorCode: completeParams.errorCode || null,
        errorMessage: completeParams.errorMessage || null,
        metadata: {
          traceparent,
          rootSpanId,
          ...(params.metadata || {}),
          ...(completeParams.metadata || {}),
        },
        spans,
      };

      this.recordTrace(record);
      return record;
    };

    return {
      traceId,
      rootSpanId,
      traceparent,
      startSpan,
      complete,
    };
  }

  /**
   * Persists trace into in-memory ring buffer and optionally exports to OTLP & Langfuse.
   */
  recordTrace(trace: TraceRecord): void {
    if (!this.isTelemetryEnabled()) {
      return;
    }

    // Apply strict redaction to strip API keys, bearer tokens, and secrets
    const sanitizedTrace = sanitizeTelemetry(trace);

    // Store in ring buffer
    this.traceBuffer.unshift(sanitizedTrace);
    if (this.traceBuffer.length > this.maxBufferSize) {
      this.traceBuffer.pop();
    }

    // Export to external collectors asynchronously (fire-and-forget, never breaks app)
    this.exportToExternalCollectors(sanitizedTrace).catch((err) => {
      this.logger.debug(`Background telemetry export note: ${err?.message || err}`);
    });
  }

  /**
   * Dispatches trace to OpenTelemetry Collector and Langfuse if configured.
   */
  private async exportToExternalCollectors(trace: TraceRecord): Promise<void> {
    const otelEndpoint = this.getOtelEndpoint();
    const langfuse = this.getLangfuseConfig();

    // 1. OpenTelemetry OTLP/HTTP export (if endpoint configured)
    if (otelEndpoint) {
      try {
        const formatOtelAttributeValue = (v: unknown): Record<string, unknown> => {
          if (typeof v === 'boolean') return { boolValue: v };
          if (typeof v === 'number') {
            return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
          }
          return { stringValue: String(v) };
        };

        const otlpPayload = {
          resourceSpans: [
            {
              resource: {
                attributes: [
                  { key: 'service.name', value: { stringValue: 'promptlab-gateway' } },
                  { key: 'service.version', value: { stringValue: this.authConfig.APP_VERSION } },
                ],
              },
              scopeSpans: [
                {
                  scope: { name: 'promptlab.tracer' },
                  spans: trace.spans.map((s) => {
                    const spanObj: Record<string, unknown> = {
                      traceId: trace.id,
                      spanId: s.id,
                      name: s.name,
                      kind: 1, // SPAN_KIND_INTERNAL
                      startTimeUnixNano: String(new Date(s.startTime).getTime() * 1_000_000),
                      endTimeUnixNano: String(new Date(s.endTime || s.startTime).getTime() * 1_000_000),
                      status: { code: s.status === 'ok' ? 1 : 2 },
                      attributes: Object.entries(s.attributes || {}).map(([k, v]) => ({
                        key: k,
                        value: formatOtelAttributeValue(v),
                      })),
                    };
                    if (s.parentSpanId) {
                      spanObj.parentSpanId = s.parentSpanId;
                    }
                    return spanObj;
                  }),
                },
              ],
            },
          ],
        };

        const tracesUrl = otelEndpoint.endsWith('/v1/traces')
          ? otelEndpoint
          : `${otelEndpoint.replace(/\/+$/, '')}/v1/traces`;

        await fetch(tracesUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(otlpPayload),
          signal: AbortSignal.timeout(2000),
        });
      } catch (err) {
        this.logger.warn(`Failed to export to OpenTelemetry collector (${otelEndpoint}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. Langfuse Ingestion API export (if public & secret keys configured)
    if (langfuse.publicKey && langfuse.secretKey) {
      try {
        const authHeader = 'Basic ' + Buffer.from(`${langfuse.publicKey}:${langfuse.secretKey}`).toString('base64');
        const eventPayload = {
          batch: [
            {
              id: trace.id,
              type: 'trace-create',
              timestamp: trace.startTime,
              body: {
                id: trace.id,
                name: trace.name,
                userId: trace.userId,
                metadata: trace.metadata,
                release: this.authConfig.APP_VERSION,
              },
            },
            {
              id: `${trace.id}-gen`,
              type: 'generation-create',
              timestamp: trace.startTime,
              body: {
                traceId: trace.id,
                name: trace.operation,
                model: trace.model,
                startTime: trace.startTime,
                endTime: trace.endTime,
                usage: {
                  input: trace.inputTokens,
                  output: trace.outputTokens,
                  total: trace.totalTokens,
                },
                metadata: {
                  provider: trace.provider,
                  estimatedCost: trace.estimatedCost,
                  status: trace.status,
                },
                level: trace.status === 'success' ? 'DEFAULT' : 'ERROR',
                statusMessage: trace.errorMessage || undefined,
              },
            },
          ],
        };

        await fetch(`${langfuse.baseUrl}/api/public/ingestion`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify(eventPayload),
          signal: AbortSignal.timeout(2000),
        });
      } catch (err) {
        this.logger.warn(`Failed to export to Langfuse (${langfuse.baseUrl}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Returns list of recorded traces with optional filters.
   */
  getTraces(filters?: {
    status?: string;
    model?: string;
    operation?: string;
    limit?: number;
  }): TraceRecord[] {
    let result = [...this.traceBuffer];

    if (filters?.status && filters.status !== 'all') {
      result = result.filter((t) => t.status === filters.status);
    }
    if (filters?.model) {
      result = result.filter((t) => t.model.toLowerCase() === filters.model?.toLowerCase());
    }
    if (filters?.operation) {
      result = result.filter((t) => t.operation === filters.operation);
    }

    const limit = Math.min(200, Math.max(1, filters?.limit || 50));
    return result.slice(0, limit);
  }

  /**
   * Returns a specific trace record by ID.
   */
  getTrace(traceId: string): TraceRecord | null {
    return this.traceBuffer.find((t) => t.id === traceId) || null;
  }

  /**
   * Returns telemetry engine status and connectivity details.
   */
  getStatus(): ObservabilityStatus {
    const otelEndpoint = this.getOtelEndpoint();
    const langfuse = this.getLangfuseConfig();

    return {
      telemetryEnabled: this.isTelemetryEnabled(),
      otelConfigured: !!otelEndpoint,
      otelEndpoint,
      langfuseConfigured: !!(langfuse.publicKey && langfuse.secretKey),
      langfuseHost: langfuse.publicKey ? langfuse.baseUrl : null,
      totalTracesRecorded: this.traceBuffer.length,
      privacyRedactionActive: true,
      supportedTracedOperations: [
        'playground.execute',
        'comparison.slot',
        'conversation.turn',
        'gateway.request',
      ],
    };
  }

  /**
   * Clears in-memory traces for test resets.
   */
  clearTraces(): void {
    this.traceBuffer.length = 0;
  }
}
