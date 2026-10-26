import { Injectable, Logger, Inject, OnApplicationShutdown, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { context, Span, SpanStatusCode, trace as otelTrace, Tracer } from '@opentelemetry/api';
import { BasicTracerProvider, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { AUTH_CONFIG, ValidatedEnvironment } from '../common/config/env.validation';
import {
  TraceRecord,
  TraceSpan,
  ObservabilityStatus,
} from './observability.types';
import { sanitizeTelemetry } from './redaction.util';
import {
  buildExportProcessors,
  createTracerProvider,
  OTEL_SPAN_PROCESSORS,
  toSafeAttributes,
  TRACER_NAME,
} from './otel-tracing';

const DEFAULT_LANGFUSE_BASE_URL = 'http://localhost:3001'; // matches .env.example and the documented local setup

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

/**
 * Tracing built on the OpenTelemetry SDK.
 *
 * Every LLM operation is a real OTel trace (crypto-random W3C IDs). Finished spans are exported in
 * batches, off the request path, to an OTLP collector and/or Langfuse (via its OTLP endpoint).
 * The service also keeps a redacted, in-memory copy of recent traces for the Observability page.
 */
@Injectable()
export class ObservabilityService implements OnApplicationShutdown {
  private readonly logger = new Logger(ObservabilityService.name);

  // In-memory ring buffer of recent traces for developer inspection
  private readonly traceBuffer: TraceRecord[] = [];
  private readonly maxBufferSize = 500;

  private readonly tracerProvider: BasicTracerProvider;
  private readonly tracer: Tracer;

  constructor(
    @Inject(AUTH_CONFIG) private readonly authConfig: ValidatedEnvironment,
    private readonly configService: ConfigService,
    @Optional() @Inject(OTEL_SPAN_PROCESSORS) extraProcessors?: SpanProcessor[],
  ) {
    const langfuse = this.getLangfuseConfig();
    const exporters = this.isTelemetryEnabled()
      ? buildExportProcessors({
          otlpEndpoint: this.getOtelEndpoint(),
          langfuse:
            langfuse.publicKey && langfuse.secretKey
              ? { baseUrl: langfuse.baseUrl, publicKey: langfuse.publicKey, secretKey: langfuse.secretKey }
              : null,
        })
      : [];

    this.tracerProvider = createTracerProvider({
      serviceVersion: this.authConfig?.APP_VERSION,
      processors: [...exporters, ...(extraProcessors ?? [])],
    });
    this.tracer = this.tracerProvider.getTracer(TRACER_NAME, this.authConfig?.APP_VERSION);
  }

  /** Flushes queued spans so nothing is lost on a graceful shutdown. */
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.tracerProvider.shutdown();
    } catch (err) {
      this.logger.warn(`Telemetry flush on shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Exports all queued spans now. Export failures are logged, never thrown. */
  async flush(): Promise<void> {
    try {
      await this.tracerProvider.forceFlush();
    } catch (err) {
      this.logger.warn(`Telemetry export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  isTelemetryEnabled(): boolean {
    return this.authConfig?.ENABLE_TELEMETRY ?? false;
  }

  getOtelEndpoint(): string | null {
    return this.configService.get<string>('OTEL_EXPORTER_OTLP_ENDPOINT') || null;
  }

  getLangfuseConfig(): { publicKey: string | null; secretKey: string | null; baseUrl: string } {
    return {
      publicKey: this.configService.get<string>('LANGFUSE_PUBLIC_KEY') || null,
      secretKey: this.configService.get<string>('LANGFUSE_SECRET_KEY') || null,
      baseUrl:
        this.authConfig?.LANGFUSE_BASEURL ||
        this.authConfig?.LANGFUSE_HOST ||
        DEFAULT_LANGFUSE_BASE_URL,
    };
  }

  /**
   * Starts a trace for an LLM operation. The root span is an OpenTelemetry span; its IDs form the
   * W3C traceparent that is forwarded to the gateway.
   */
  startTrace(params: {
    name: string;
    operation: 'playground.execute' | 'comparison.slot' | 'conversation.turn' | 'compaction.preview' | 'gateway.request';
    model: string;
    provider: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }): ActiveTraceContext {
    const traceStartTime = new Date();
    const rootAttributes: Record<string, unknown> = {
      'llm.model': params.model,
      'llm.provider': params.provider,
      'operation.name': params.operation,
      'gen_ai.request.model': params.model,
      'gen_ai.system': params.provider,
      ...(params.userId ? { 'user.id': params.userId } : {}),
      ...(params.metadata || {}),
    };
    const rootOtelSpan: Span = this.tracer.startSpan(params.name, {
      startTime: traceStartTime,
      attributes: toSafeAttributes(rootAttributes),
    });
    const rootContext = otelTrace.setSpan(context.active(), rootOtelSpan);
    const { traceId, spanId: rootSpanId } = rootOtelSpan.spanContext();
    const traceparent = `00-${traceId}-${rootSpanId}-01`;
    const spans: TraceSpan[] = [];
    const otelSpans = new Map<string, Span>();

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

    const endOtelSpan = (
      otelSpan: Span,
      status: 'ok' | 'error',
      endTime: Date,
      attributes: Record<string, unknown>,
    ) => {
      otelSpan.setAttributes(toSafeAttributes(attributes));
      otelSpan.setStatus({ code: status === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR });
      otelSpan.end(endTime);
    };

    const startSpan = (name: string, attributes?: Record<string, unknown>): ActiveSpan => {
      const spanStart = new Date();
      const otelSpan = this.tracer.startSpan(
        name,
        { startTime: spanStart, attributes: toSafeAttributes(attributes) },
        rootContext,
      );
      const spanId = otelSpan.spanContext().spanId;
      otelSpans.set(spanId, otelSpan);
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
          if (span.endTime) return; // ending twice is a no-op, as in OpenTelemetry
          const spanEnd = new Date();
          endOtelSpan(otelSpan, status, spanEnd, endAttributes);
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

      // Never export a span without an end time. Any child span a code path forgot to
      // close (early return, unexpected throw) is closed here and flagged so the gap is visible.
      for (const span of spans) {
        if (span !== rootSpan && !span.endTime) {
          span.endTime = traceEndTime.toISOString();
          span.durationMs = traceEndTime.getTime() - new Date(span.startTime).getTime();
          span.status = completeParams.status === 'success' ? 'ok' : 'error';
          span.attributes = { ...span.attributes, 'span.closed_by_trace': true };
          const otelSpan = otelSpans.get(span.id);
          if (otelSpan) endOtelSpan(otelSpan, span.status, traceEndTime, { 'span.closed_by_trace': true });
        }
      }

      rootSpan.endTime = traceEndTime.toISOString();
      rootSpan.durationMs = durationMs;
      rootSpan.status = completeParams.status === 'success' ? 'ok' : 'error';
      endOtelSpan(rootOtelSpan, rootSpan.status, traceEndTime, {
        'trace.status': completeParams.status,
        'gen_ai.usage.input_tokens': completeParams.usage?.promptTokens,
        'gen_ai.usage.output_tokens': completeParams.usage?.completionTokens,
        'llm.usage.total_tokens': completeParams.usage?.totalTokens,
        'llm.usage.source': completeParams.usage?.source,
        'llm.cost.estimated': completeParams.cost ?? undefined,
        'error.type': completeParams.errorCode || undefined,
        'error.message': completeParams.errorMessage || undefined,
        ...(completeParams.metadata || {}),
      });

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
   * Stores a redacted copy of a finished trace in the in-memory ring buffer for the UI.
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

    // Export to OTLP / Langfuse happens through the OpenTelemetry batch span processors.
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
        'compaction.preview',
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
