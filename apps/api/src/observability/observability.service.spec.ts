import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ObservabilityService } from './observability.service';
import { sanitizeTelemetry } from './redaction.util';

describe('ObservabilityService', () => {
  let service: ObservabilityService;
  let configServiceMock: { get: jest.Mock };

  beforeEach(async () => {
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

  describe('disabled telemetry', () => {
    it('does not record traces when ENABLE_TELEMETRY is false', () => {
      configServiceMock.get.mockImplementation((key: string) => {
        if (key === 'ENABLE_TELEMETRY') return 'false';
        return null;
      });

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

    it('respects validated authConfig.ENABLE_TELEMETRY when provided (OBS-01)', () => {
      const serviceWithConfig = new ObservabilityService(
        configServiceMock as any,
        { ENABLE_TELEMETRY: false } as any,
      );
      expect(serviceWithConfig.isTelemetryEnabled()).toBe(false);

      const serviceWithConfigTrue = new ObservabilityService(
        configServiceMock as any,
        { ENABLE_TELEMETRY: true } as any,
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

  describe('external collector resilience and formatting', () => {
    it('formats valid OpenTelemetry OTLP JSON payload with stringified nano timestamps and typed attributes', async () => {
      configServiceMock.get.mockImplementation((key: string) => {
        if (key === 'ENABLE_TELEMETRY') return 'true';
        if (key === 'OTEL_EXPORTER_OTLP_ENDPOINT') return 'http://127.0.0.1:4318/v1/traces';
        return null;
      });

      let capturedPayload: any = null;
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url, init) => {
        if (typeof init?.body === 'string') {
          capturedPayload = JSON.parse(init.body);
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      });

      try {
        const trace = service.startTrace({
          name: 'otlp-format-test',
          operation: 'playground.execute',
          model: 'gpt-4o',
          provider: 'openai',
          userId: 'dev-user-001',
        });

        const span = trace.startSpan('quota.reserve', {
          count: 500,
          active: true,
          label: 'test-span',
        });
        span.end('ok');

        trace.complete({ status: 'success' });

        expect(capturedPayload).toBeDefined();
        const resourceSpan = capturedPayload.resourceSpans[0];
        expect(resourceSpan.resource.attributes[0].key).toBe('service.name');
        expect(resourceSpan.resource.attributes[0].value.stringValue).toBe('promptlab-gateway');

        const spans = resourceSpan.scopeSpans[0].spans;
        expect(spans.length).toBe(2);

        // Verify root span
        const root = spans[0];
        expect(root.traceId).toBe(trace.traceId);
        expect(root.spanId).toBe(trace.rootSpanId);
        expect(typeof root.startTimeUnixNano).toBe('string');
        expect(typeof root.endTimeUnixNano).toBe('string');
        expect(root.parentSpanId).toBeUndefined();

        // Verify child span
        const child = spans[1];
        expect(child.traceId).toBe(trace.traceId);
        expect(child.parentSpanId).toBe(trace.rootSpanId);
        expect(child.name).toBe('quota.reserve');
        expect(child.status.code).toBe(1);

        // Verify proto3 typed attribute values
        const countAttr = child.attributes.find((a: any) => a.key === 'count');
        expect(countAttr.value.intValue).toBe('500');

        const activeAttr = child.attributes.find((a: any) => a.key === 'active');
        expect(activeAttr.value.boolValue).toBe(true);

        const labelAttr = child.attributes.find((a: any) => a.key === 'label');
        expect(labelAttr.value.stringValue).toBe('test-span');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('handles OTLP and Langfuse endpoint network errors gracefully without throwing', async () => {
      configServiceMock.get.mockImplementation((key: string) => {
        if (key === 'ENABLE_TELEMETRY') return 'true';
        if (key === 'OTEL_EXPORTER_OTLP_ENDPOINT') return 'http://127.0.0.1:4318/v1/traces';
        if (key === 'LANGFUSE_PUBLIC_KEY') return 'pk-lf-test';
        if (key === 'LANGFUSE_SECRET_KEY') return 'sk-lf-test';
        if (key === 'LANGFUSE_BASEURL') return 'http://127.0.0.1:3000';
        return null;
      });

      // Mock global fetch to simulate network error or timeout
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused to telemetry collector'));

      try {
        const trace = service.startTrace({
          name: 'resilience-test',
          operation: 'playground.execute',
          model: 'gpt-4o',
          provider: 'openai',
        });

        // Completing must not throw an exception even if fetch fails
        expect(() => {
          trace.complete({ status: 'success' });
        }).not.toThrow();

        // Trace must still be stored in local buffer
        const stored = service.getTrace(trace.traceId);
        expect(stored).toBeDefined();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
