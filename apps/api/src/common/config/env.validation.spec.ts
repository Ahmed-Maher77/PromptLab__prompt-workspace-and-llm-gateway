import { validateEnvironment, DEV_MASTER_KEY, parseApiKeys } from './env.validation';

describe('validateEnvironment', () => {
  it('throws an error when DATABASE_URL is missing or empty', () => {
    expect(() => validateEnvironment({})).toThrow(
      /Missing mandatory environment configuration: DATABASE_URL/,
    );
    expect(() => validateEnvironment({ DATABASE_URL: '' })).toThrow(
      /Missing mandatory environment configuration: DATABASE_URL/,
    );
  });

  it('validates and applies default port 3100 and default CORS origin', () => {
    const config = validateEnvironment({
      DATABASE_URL: 'postgresql://postgres:admin@localhost:5432/promptlab',
    });

    expect(config.DATABASE_URL).toBe('postgresql://postgres:admin@localhost:5432/promptlab');
    expect(config.PORT).toBe(3100);
    expect(config.CORS_ORIGIN).toBe('http://localhost:4200');
    expect(config.LITELLM_GATEWAY_URL).toBe('http://127.0.0.1:4000');
    expect(config.LITELLM_MASTER_KEY).toBe(DEV_MASTER_KEY);
    expect(config.TELEMETRY_ENABLED).toBe(true);
  });

  it('parses custom PORT and comma-delimited CORS origins', () => {
    const config = validateEnvironment({
      DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      PORT: '8080',
      CORS_ORIGIN: 'http://localhost:4200, https://promptlab.internal',
    });

    expect(config.PORT).toBe(8080);
    expect(config.CORS_ORIGIN).toEqual(['http://localhost:4200', 'https://promptlab.internal']);
  });

  it('handles invalid numeric PORT by falling back safely to 3100', () => {
    const config = validateEnvironment({
      DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      PORT: 'invalid-port',
    });

    expect(config.PORT).toBe(3100);
  });

  it('supports LITELLM_PROXY_URL fallback and LITELLM_GATEWAY_URL precedence', () => {
    const configWithProxyOnly = validateEnvironment({
      DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      LITELLM_PROXY_URL: 'http://proxy.internal:4000',
    });
    expect(configWithProxyOnly.LITELLM_GATEWAY_URL).toBe('http://proxy.internal:4000');

    const configWithBoth = validateEnvironment({
      DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      LITELLM_GATEWAY_URL: 'http://gateway.internal:4000',
      LITELLM_PROXY_URL: 'http://proxy.internal:4000',
    });
    expect(configWithBoth.LITELLM_GATEWAY_URL).toBe('http://gateway.internal:4000');
  });

  describe('SEC-03: production fail-fast for LITELLM_MASTER_KEY', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      NODE_ENV: 'production',
      AUTH_API_KEYS: 'prod-key:admin-001:admin',
    };

    it('throws in production when LITELLM_MASTER_KEY is absent', () => {
      expect(() => validateEnvironment({ ...baseEnv })).toThrow(
        /LITELLM_MASTER_KEY must be set to a strong, unique secret in production/,
      );
    });

    it('throws in production when LITELLM_MASTER_KEY equals the dev default', () => {
      expect(() =>
        validateEnvironment({ ...baseEnv, LITELLM_MASTER_KEY: DEV_MASTER_KEY }),
      ).toThrow(/LITELLM_MASTER_KEY must be set to a strong, unique secret in production/);
    });

    it('does NOT throw in production when a proper key is supplied', () => {
      expect(() =>
        validateEnvironment({ ...baseEnv, LITELLM_MASTER_KEY: 'sk-super-secret-prod-key' }),
      ).not.toThrow();
    });

    it('does NOT throw in development when LITELLM_MASTER_KEY is absent (uses dev default)', () => {
      expect(() =>
        validateEnvironment({
          DATABASE_URL: 'postgresql://localhost:5432/promptlab',
          NODE_ENV: 'development',
        }),
      ).not.toThrow();
    });
  });

  describe('SEC-01a: production fail-fast for authentication configuration', () => {
    const baseProdEnv = {
      DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      NODE_ENV: 'production',
      LITELLM_MASTER_KEY: 'sk-real-prod-master-key',
    };

    it('throws in production when no auth method is configured', () => {
      expect(() => validateEnvironment({ ...baseProdEnv })).toThrow(
        /In production, a secure authentication configuration is mandatory/,
      );
    });

    it('throws in production when AUTH_JWT_SECRET is less than 32 characters', () => {
      expect(() =>
        validateEnvironment({
          ...baseProdEnv,
          AUTH_JWT_SECRET: 'short-secret-less-than-32-char',
        }),
      ).toThrow(/AUTH_JWT_SECRET must be at least 32 characters long in production/);
    });

    it('succeeds in production when valid AUTH_API_KEYS are provided', () => {
      const config = validateEnvironment({
        ...baseProdEnv,
        AUTH_API_KEYS: 'my-strong-api-key:prod-admin:admin',
      });
      expect(config.AUTH_API_KEYS.length).toBe(1);
      expect(config.AUTH_API_KEYS[0].user.id).toBe('prod-admin');
      expect(config.AUTH_API_KEYS[0].user.role).toBe('admin');
    });

    it('succeeds in production when valid AUTH_JWT_SECRET (>= 32 chars) is provided', () => {
      const config = validateEnvironment({
        ...baseProdEnv,
        AUTH_JWT_SECRET: 'super-secure-production-jwt-secret-min-32-chars',
      });
      expect(config.AUTH_JWT_SECRET).toBe('super-secure-production-jwt-secret-min-32-chars');
    });

    it('parses multiple API keys correctly', () => {
      const parsed = parseApiKeys(
        'key1:user-1:admin, key2:user-2:user, invalid-entry',
      );
      expect(parsed.length).toBe(2);
      expect(parsed[0].user.id).toBe('user-1');
      expect(parsed[0].user.role).toBe('admin');
      expect(parsed[1].user.id).toBe('user-2');
      expect(parsed[1].user.role).toBe('user');
    });
  });
});
