import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ObservabilityService } from './observability.service';
import { sanitizeTelemetry } from './redaction.util';
import { AUTH_CONFIG } from '../common/config/env.validation';
import { SpanStatusCode } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  SpanExporter,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { buildExportProcessors, CryptoIdGenerator, langfuseOtlpUrl, otlpTracesUrl } from './otel-tracing';

describe('ObservabilityService', () => {
  let service: ObservabilityService;
  let configServiceMock: { get: jest.Mock };
  let authConfigMock: { ENABLE_TELEMETRY: boolean };

  beforeEach(async () => {
    authConfigMock = { ENABLE_TELEMETRY: true };
    configServiceMock = {
      get: jest.fn((key: string) => {
        if (key === 'ENABLE_TELEMETRY') return 'true';
        if (key === 'OTEL_EXPORTER_OTLP_ENDPOINT') return null;
        if (key === 'LANGFUSE_PUBLIC_KEY') return null;
        if (key === 'LANGFUSE_SECRET_KEY') return null;
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObservabilityService,
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
        {
          provide: AUTH_CONFIG,
          useValue: authConfigMock,
        },
      ],
    }).compile();

    service = module.get<ObservabilityService>(ObservabilityService);
    service.clearTraces();
  });

  describe('startTrace and complete', () => {
    it('creates active trace context with valid W3C traceparent header and root span', () => {
      const trace = service.startTrace({
        name: 'test-playground-run',
        operation: 'playground.execute',
        model: 'gpt-4o',
        provider: 'openai',
        userId: 'user-123',
      });

      expect(trace.traceId).toBeDefined();
      expect(trace.traceId.length).toBe(32);
      expect(trace.rootSpanId.length).toBe(16);
      expect(trace.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);

      // Add a child span
      const childSpan = trace.startSpan('quota.reserve', { quotaReserved: 1000 });
      expect(childSpan.id.length).toBe(16);
      childSpan.end('ok', { quotaAllocated: true });

      // Complete the trace
      const record = trace.complete({
        status: 'success',
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          source: 'litellm',
        },
        cost: 0.00025,
      });

      expect(record.id).toBe(trace.traceId);
      expect(record.model).toBe('gpt-4o');
      expect(record.totalTokens).toBe(30);
      expect(record.status).toBe('success');
      expect(record.spans.length).toBe(2);
      expect(record.spans[0].name).toBe('test-playground-run');
      expect(record.spans[1].name).toBe('quota.reserve');
      expect(record.spans[1].parentSpanId).toBe(trace.rootSpanId);

      // Verify trace is retrieved from buffer
      const stored = service.getTrace(trace.traceId);
      expect(stored).toBeDefined();
      expect(stored?.id).toBe(trace.traceId);
    });

    it('filters traces by status and operation', () => {
      const t1 = service.startTrace({
        name: 'run-1',
        operation: 'playground.execute',
        model: 'gpt-4o',
        provider: 'openai',
      });
      t1.complete({ status: 'success' });

      const t2 = service.startTrace({
        name: 'run-2',
        operation: 'conversation.turn',
        model: 'claude-3-5-sonnet',
        provider: 'anthropic',
      });
      t2.complete({ status: 'error', errorMessage: 'Upstream gateway error' });

      const all = service.getTraces();
      expect(all.length).toBe(2);

      const errTraces = service.getTraces({ status: 'error' });
      expect(errTraces.length).toBe(1);
      expect(errTraces[0].operation).toBe('conversation.turn');

      const playgroundTraces = service.getTraces({ operation: 'playground.execute' });
      expect(playgroundTraces.length).toBe(1);
      expect(playgroundTraces[0].name).toBe('run-1');
    });
  });

  describe('span closure on completion', () => {
    it('closes and flags child spans left open when the trace completes', () => {
      const trace = service.startTrace({
        name: 'early-exit',
        operation: 'playground.execute',
        model: 'gpt-4o-mini',
        provider: 'openai',
        userId: 'user-1',
      });
      const closed = trace.startSpan('quota.reserve');
      closed.end('ok');
      trace.startSpan('litellm.chat_completion'); // never ended by the caller

      const record = trace.complete({ status: 'error', errorCode: 'EXECUTION_EXCEPTION' });

      for (const span of record.spans) {
        expect(span.endTime).not.toBe('');
        expect(span.durationMs).toBeGreaterThanOrEqual(0);
      }
      const open = record.spans.find((s) => s.name === 'litellm.chat_completion')!;
      expect(open.status).toBe('error');
      expect(open.attributes['span.closed_by_trace']).toBe(true);
      const reserve = record.spans.find((s) => s.name === 'quota.reserve')!;
      expect(reserve.status).toBe('ok');
      expect(reserve.attributes['span.closed_by_trace']).toBeUndefined();
    });

    it('records rate_limited as the trace status', () => {
      const trace = service.startTrace({
        name: 'limited',
        operation: 'playground.execute',
        model: 'gpt-4o-mini',
        provider: 'openai',
        userId: 'user-1',
      });
      const record = trace.complete({ status: 'rate_limited', errorCode: 'RATE_LIMIT_EXCEEDED' });
      expect(record.status).toBe('rate_limited');
      expect(service.getTraces({ status: 'rate_limited' } as any).map((t: any) => t.id)).toContain(record.id);
    });
  });

  describe('disabled telemetry', () => {
    it('does not record traces when ENABLE_TELEMETRY is false', () => {
      authConfigMock.ENABLE_TELEMETRY = false;

      const trace = service.startTrace({
        name: 'disabled-run',
        operation: 'playground.execute',
        model: 'gpt-4o',
        provider: 'openai',
      });
      trace.complete({ status: 'success' });

      const traces = service.getTraces();
      expect(traces.length).toBe(0);
    });

    it('respects validated authConfig.ENABLE_TELEMETRY', () => {
      const serviceWithConfig = new ObservabilityService(
        { ENABLE_TELEMETRY: false } as any,
        configServiceMock as any,
      );
      expect(serviceWithConfig.isTelemetryEnabled()).toBe(false);

      const serviceWithConfigTrue = new ObservabilityService(
        { ENABLE_TELEMETRY: true } as any,
        configServiceMock as any,
      );
      expect(serviceWithConfigTrue.isTelemetryEnabled()).toBe(true);
    });
  });

  describe('redaction and privacy', () => {
    it('sanitizes API keys, authorization headers, and bearer tokens in metadata and spans', () => {
      const trace = service.startTrace({
        name: 'privacy-test',
        operation: 'playground.execute',
        model: 'gpt-4o',
        provider: 'openai',
        metadata: {
          apiKey: 'sk-proj-1234567890abcdef1234567890',
          authorization: 'Bearer secret_token_xyz',
          safeProperty: 'allow_this_value',
        },
      });

      const span = trace.startSpan('upstream.call', {
        headers: {
          'x-api-key': 'secret-header-value',
        },
        payloadSnippet: 'user with key sk-live-secret-test was here',
      });
      span.end();

      const record = trace.complete({
        status: 'success',
      });

      // Stored record should have sanitized metadata and span attributes
      const stored = service.getTrace(record.id);
      expect(stored).toBeDefined();
      expect(stored!.metadata['apiKey']).toBe('[REDACTED]');
      expect(stored!.metadata['authorization']).toBe('[REDACTED]');
      expect(stored!.metadata['safeProperty']).toBe('allow_this_value');

      const childSpan = stored!.spans.find((s) => s.name === 'upstream.call');
      expect(childSpan).toBeDefined();
      const headers = childSpan!.attributes['headers'] as Record<string, unknown>;
      expect(headers['x-api-key']).toBe('[REDACTED]');
      expect(childSpan!.attributes['payloadSnippet']).toBe(
        'user with key [REDACTED_API_KEY] was here',
      );
    });

    it('preserves numeric token metrics such as inputTokens, outputTokens, and totalTokens without broad redaction', () => {
      const data = {
        inputTokens: 150,
        outputTokens: 75,
        totalTokens: 225,
        promptTokens: 150,
        completionTokens: 75,
        reservedTokens: 1000,
        maxTokens: 2048,
        apiKey: 'secret_key_123',
        authToken: 'jwt_token_abc',
      };

      const sanitized = sanitizeTelemetry(data);
      expect(sanitized.inputTokens).toBe(150);
      expect(sanitized.outputTokens).toBe(75);
      expect(sanitized.totalTokens).toBe(225);
      expect(sanitized.promptTokens).toBe(150);
      expect(sanitized.completionTokens).toBe(75);
      expect(sanitized.reservedTokens).toBe(1000);
      expect(sanitized.maxTokens).toBe(2048);
      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.authToken).toBe('[REDACTED]');
    });

    it('redaction helper correctly masks raw strings', () => {
      const data = {
        token: 'sk-9999999999999999999999999999',
        bearer: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
        normal: 'Hello PromptLab',
      };
      const sanitized = sanitizeTelemetry(data);
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.bearer).toBe('[REDACTED]');
      expect(sanitized.normal).toBe('Hello PromptLab');
    });
  });

  describe('OpenTelemetry export', () => {
    const buildService = (
      processors: SpanProcessor[],
      config: Record<string, unknown> = { ENABLE_TELEMETRY: true, APP_VERSION: '1.2.3' },
    ) => new ObservabilityService(config as any, configServiceMock as any, processors);

    it('exports the root and child spans with the IDs used in the traceparent', async () => {
      const exporter = new InMemorySpanExporter();
      const otelService = buildService([new SimpleSpanProcessor(exporter)]);

      const trace = otelService.startTrace({
        name: 'otel-test',
        operation: 'playground.execute',
        model: 'gpt-4o',
        provider: 'openai',
        userId: 'user-1',
      });
      const span = trace.startSpan('quota.reserve', { count: 500, active: true, label: 'test-span', nested: { a: 1 } });
      span.end('ok');
      trace.complete({
        status: 'success',
        usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20, source: 'provider-reported' },
        cost: 0.0004,
      });
      await otelService.flush();

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(2);
      const root = spans.find((s) => s.name === 'otel-test')!;
      const child = spans.find((s) => s.name === 'quota.reserve')!;

      expect(trace.traceparent).toBe(`00-${root.spanContext().traceId}-${root.spanContext().spanId}-01`);
      expect(root.spanContext().traceId).toBe(trace.traceId);
      expect(child.spanContext().traceId).toBe(trace.traceId);
      expect(child.parentSpanContext?.spanId).toBe(trace.rootSpanId);

      expect(child.attributes).toMatchObject({ count: 500, active: true, label: 'test-span', nested: '{"a":1}' });
      expect(child.status.code).toBe(SpanStatusCode.OK);
      expect(root.attributes).toMatchObject({
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.system': 'openai',
        'gen_ai.usage.input_tokens': 12,
        'gen_ai.usage.output_tokens': 8,
        'llm.cost.estimated': 0.0004,
        'user.id': 'user-1',
        'trace.status': 'success',
      });
      expect(root.resource.attributes).toMatchObject({ 'service.name': 'promptlab-api', 'service.version': '1.2.3' });
    });

    it('redacts secrets before they reach the exporter', async () => {
      const exporter = new InMemorySpanExporter();
      const otelService = buildService([new SimpleSpanProcessor(exporter)]);

      const trace = otelService.startTrace({
        name: 'redaction',
        operation: 'playground.execute',
        model: 'gpt-4o',
        provider: 'openai',
        metadata: { apiKey: 'sk-live-1234567890abcdef' },
      });
      trace.complete({ status: 'error', errorMessage: 'upstream said Bearer abc.def.ghi and sk-abcdefghijklmnop' });
      await otelService.flush();

      const [root] = exporter.getFinishedSpans();
      expect(root.attributes.apiKey).toBe('[REDACTED]');
      expect(root.attributes['error.message']).toBe('upstream said [REDACTED_BEARER] and [REDACTED_API_KEY]');
      expect(root.status.code).toBe(SpanStatusCode.ERROR);
    });

    it('exports a child span left open, flagged as closed by the trace', async () => {
      const exporter = new InMemorySpanExporter();
      const otelService = buildService([new SimpleSpanProcessor(exporter)]);

      const trace = otelService.startTrace({ name: 'open', operation: 'conversation.turn', model: 'm', provider: 'p' });
      trace.startSpan('litellm.chat_completion');
      trace.complete({ status: 'error' });
      await otelService.flush();

      const child = exporter.getFinishedSpans().find((s) => s.name === 'litellm.chat_completion')!;
      expect(child.attributes['span.closed_by_trace']).toBe(true);
      expect(child.status.code).toBe(SpanStatusCode.ERROR);
    });

    it('never throws on the request path when the exporter fails', async () => {
      const failing: SpanExporter = {
        export: (_spans, done) => done({ code: ExportResultCode.FAILED, error: new Error('collector down') }),
        shutdown: () => Promise.resolve(),
      };
      const otelService = buildService([new SimpleSpanProcessor(failing)]);

      const trace = otelService.startTrace({ name: 'resilience', operation: 'playground.execute', model: 'm', provider: 'p' });
      expect(() => trace.complete({ status: 'success' })).not.toThrow();
      await expect(otelService.flush()).resolves.toBeUndefined();
      expect(otelService.getTrace(trace.traceId)).toBeDefined();
    });

    it('flushes queued spans on application shutdown', async () => {
      const processor = new SimpleSpanProcessor(new InMemorySpanExporter());
      const shutdown = jest.spyOn(processor, 'shutdown');
      await buildService([processor]).onApplicationShutdown();
      expect(shutdown).toHaveBeenCalled();
    });
  });

  describe('export targets', () => {
    it('creates one batching exporter per configured backend', () => {
      expect(buildExportProcessors({})).toHaveLength(0);
      expect(buildExportProcessors({ otlpEndpoint: 'http://collector:4318' })).toHaveLength(1);
      expect(
        buildExportProcessors({
          otlpEndpoint: 'http://collector:4318',
          langfuse: { baseUrl: 'http://langfuse:3000', publicKey: 'pk', secretKey: 'sk' },
        }),
      ).toHaveLength(2);
    });

    it('normalises the OTLP and Langfuse URLs', () => {
      expect(otlpTracesUrl('http://collector:4318')).toBe('http://collector:4318/v1/traces');
      expect(otlpTracesUrl('http://collector:4318/')).toBe('http://collector:4318/v1/traces');
      expect(otlpTracesUrl('http://collector:4318/v1/traces')).toBe('http://collector:4318/v1/traces');
      expect(langfuseOtlpUrl('https://cloud.langfuse.com/')).toBe('https://cloud.langfuse.com/api/public/otel/v1/traces');
    });

    it('uses the documented Langfuse default when no host is configured', () => {
      expect(service.getLangfuseConfig().baseUrl).toBe('http://localhost:3001');
    });

    it('generates crypto-random, non-zero W3C IDs', () => {
      const ids = new CryptoIdGenerator();
      const traceIds = new Set(Array.from({ length: 200 }, () => ids.generateTraceId()));
      expect(traceIds.size).toBe(200);
      for (const id of traceIds) {
        expect(id).toMatch(/^[0-9a-f]{32}$/);
        expect(id).not.toBe('0'.repeat(32));
      }
      expect(ids.generateSpanId()).toMatch(/^[0-9a-f]{16}$/);
    });
  });
});
