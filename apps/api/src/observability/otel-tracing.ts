import { Attributes, AttributeValue } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  IdGenerator,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { generateSpanId, generateTraceId, sanitizeTelemetry } from './redaction.util';

/** Injection token for additional span processors (used by tests to capture exported spans). */
export const OTEL_SPAN_PROCESSORS = Symbol('OTEL_SPAN_PROCESSORS');

export const TRACER_NAME = 'promptlab-api';

/** Cryptographically random, never all-zero trace and span IDs (the SDK default uses Math.random). */
export class CryptoIdGenerator implements IdGenerator {
  generateTraceId(): string {
    return generateTraceId();
  }

  generateSpanId(): string {
    return generateSpanId();
  }
}

export interface OtelExportTargets {
  otlpEndpoint?: string | null;
  langfuse?: { baseUrl: string; publicKey: string; secretKey: string } | null;
}

/** Normalises an OTLP/HTTP base endpoint (e.g. http://collector:4318) to its traces URL. */
export function otlpTracesUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith('/v1/traces') ? trimmed : `${trimmed}/v1/traces`;
}

/** Langfuse accepts OTLP/HTTP traces on this path, authenticated with its key pair. */
export function langfuseOtlpUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/public/otel/v1/traces`;
}

const EXPORT_TIMEOUT_MS = 5000;

/** One batching processor per configured backend. Spans are queued and exported off the request path. */
export function buildExportProcessors(targets: OtelExportTargets): SpanProcessor[] {
  const processors: SpanProcessor[] = [];
  const batch = { maxQueueSize: 2048, maxExportBatchSize: 256, scheduledDelayMillis: 2000 };

  if (targets.otlpEndpoint) {
    processors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: otlpTracesUrl(targets.otlpEndpoint), timeoutMillis: EXPORT_TIMEOUT_MS }),
        batch,
      ),
    );
  }

  if (targets.langfuse) {
    const { baseUrl, publicKey, secretKey } = targets.langfuse;
    processors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: langfuseOtlpUrl(baseUrl),
          headers: { Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}` },
          timeoutMillis: EXPORT_TIMEOUT_MS,
        }),
        batch,
      ),
    );
  }

  return processors;
}

export function createTracerProvider(params: {
  serviceVersion?: string;
  processors: SpanProcessor[];
}): BasicTracerProvider {
  return new BasicTracerProvider({
    resource: resourceFromAttributes({
      'service.name': TRACER_NAME,
      ...(params.serviceVersion ? { 'service.version': params.serviceVersion } : {}),
    }),
    idGenerator: new CryptoIdGenerator(),
    spanProcessors: params.processors,
  });
}

function toAttributeValue(value: unknown): AttributeValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) return value as number[];
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Redacts secrets and converts arbitrary values into valid OpenTelemetry attribute values. */
export function toSafeAttributes(input: Record<string, unknown> | undefined): Attributes {
  const sanitized = sanitizeTelemetry(input ?? {});
  const attributes: Attributes = {};
  for (const [key, value] of Object.entries(sanitized)) {
    const converted = toAttributeValue(value);
    if (converted !== undefined) attributes[key] = converted;
  }
  return attributes;
}
