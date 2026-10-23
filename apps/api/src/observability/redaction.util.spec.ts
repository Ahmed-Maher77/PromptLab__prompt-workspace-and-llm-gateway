import {
  sanitizeTelemetry,
  generateTraceId,
  generateSpanId,
} from './redaction.util';

describe('redaction.util', () => {
  describe('sanitizeTelemetry', () => {
    it('returns null or undefined as-is', () => {
      expect(sanitizeTelemetry(null)).toBeNull();
      expect(sanitizeTelemetry(undefined)).toBeUndefined();
    });

    it('redacts sk- API keys and Bearer tokens inside string values', () => {
      const raw = 'Authorization: Bearer my-secret-token-123456';
      expect(sanitizeTelemetry(raw)).toBe('Authorization: [REDACTED_BEARER]');

      const withApiKey = 'Calling OpenAI with sk-proj-1234567890abcdef123';
      expect(sanitizeTelemetry(withApiKey)).toBe('Calling OpenAI with [REDACTED_API_KEY]');

      const withPk = 'Calling Anthropic with pk-ant-1234567890abcdef123';
      expect(sanitizeTelemetry(withPk)).toBe('Calling Anthropic with [REDACTED_API_KEY]');
    });

    it('redacts sensitive object keys (apiKey, password, secret, token)', () => {
      const payload = {
        apiKey: 'secret-key-123',
        password: 'admin-password',
        clientSecret: 'secret-value',
        token: 'auth-token-xyz',
        safeProperty: 'hello world',
      };

      const sanitized = sanitizeTelemetry(payload);
      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.clientSecret).toBe('[REDACTED]');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.safeProperty).toBe('hello world');
    });

    it('preserves numeric token metrics without redacting them', () => {
      const metrics = {
        inputTokens: 150,
        outputTokens: 75,
        totalTokens: 225,
        promptTokens: 150,
        completionTokens: 75,
        reservedTokens: 300,
        actualTokens: 225,
        tokenLimit: 100000,
      };

      const sanitized = sanitizeTelemetry(metrics);
      expect(sanitized.inputTokens).toBe(150);
      expect(sanitized.outputTokens).toBe(75);
      expect(sanitized.totalTokens).toBe(225);
      expect(sanitized.promptTokens).toBe(150);
      expect(sanitized.completionTokens).toBe(75);
      expect(sanitized.reservedTokens).toBe(300);
      expect(sanitized.actualTokens).toBe(225);
      expect(sanitized.tokenLimit).toBe(100000);
    });

    it('recursively sanitizes nested objects and arrays', () => {
      const nested = {
        user: {
          name: 'Ahmed',
          authToken: 'sensitive-jwt-token',
        },
        items: [
          { key: 'Bearer 987654321abcdef' },
          { count: 42, note: 'ok' },
        ],
      };

      const sanitized = sanitizeTelemetry(nested);
      expect(sanitized.user.authToken).toBe('[REDACTED]');
      expect(sanitized.user.name).toBe('Ahmed');
      expect(sanitized.items[0].key).toBe('[REDACTED_BEARER]');
      expect(sanitized.items[1].count).toBe(42);
    });
  });

  describe('generateTraceId and generateSpanId', () => {
    it('generates a 32-character hexadecimal traceId', () => {
      const traceId = generateTraceId();
      expect(traceId.length).toBe(32);
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generates a 16-character hexadecimal spanId', () => {
      const spanId = generateSpanId();
      expect(spanId.length).toBe(16);
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    });
  });
});
