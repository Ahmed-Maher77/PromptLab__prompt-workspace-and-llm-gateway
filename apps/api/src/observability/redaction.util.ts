const SENSITIVE_KEY_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /auth(orization)?/i,
  /bearer/i,
  /password/i,
  /(access|refresh|auth|session|csrf|bearer|secret)[_-]?token/i,
  /^token$/i,
  /credential/i,
];

// Explicitly protect numeric token metrics from broad token-key redaction
const TOKEN_METRIC_KEY_PATTERNS = [
  /input[_-]?tokens?/i,
  /output[_-]?tokens?/i,
  /total[_-]?tokens?/i,
  /prompt[_-]?tokens?/i,
  /completion[_-]?tokens?/i,
  /reserved[_-]?tokens?/i,
  /max[_-]?tokens?/i,
  /tokens?[_-]?limit/i,
  /actual[_-]?tokens?/i,
];

const SECRET_VALUE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /Bearer\s+[A-Za-z0-9_\-.]+/gi, replacement: '[REDACTED_BEARER]' },
  { pattern: /sk-[A-Za-z0-9_\-]{10,}/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /pk-[A-Za-z0-9_\-]{10,}/g, replacement: '[REDACTED_API_KEY]' },
];

/**
 * Redacts secret keys, bearer tokens, and credentials from telemetry objects
 * to ensure sensitive customer content and API keys never leak into traces.
 * Preserves numeric token usage metrics (e.g. inputTokens, totalTokens, promptTokens).
 */
export function sanitizeTelemetry<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    let sanitized: string = input;
    for (const { pattern, replacement } of SECRET_VALUE_PATTERNS) {
      sanitized = sanitized.replace(pattern, replacement);
    }
    return sanitized as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeTelemetry(item)) as unknown as T;
  }

  if (typeof input === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      const isTokenMetric = TOKEN_METRIC_KEY_PATTERNS.some((pattern) => pattern.test(key));
      const isSensitiveKey = !isTokenMetric && SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));

      // Never redact numeric counts even if key has 'token'
      if (isSensitiveKey && typeof value !== 'number') {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitizeTelemetry(value);
      }
    }
    return result as T;
  }

  return input;
}

/**
 * Generates a standard W3C compliant 32-character hex traceId.
 */
export function generateTraceId(): string {
  let hex = '';
  for (let i = 0; i < 4; i++) {
    hex += Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  }
  return hex;
}

/**
 * Generates a standard W3C compliant 16-character hex spanId.
 */
export function generateSpanId(): string {
  let hex = '';
  for (let i = 0; i < 2; i++) {
    hex += Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  }
  return hex;
}
