import {
  validateEnvironment,
  DEV_MASTER_KEY,
  parseApiKeys,
  KNOWN_EXAMPLE_SECRETS,
} from './env.validation';

describe('validateEnvironment (secure by default)', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it('throws an error when DATABASE_URL is missing or empty', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'development' })).toThrow(
      /Missing mandatory environment configuration: DATABASE_URL/,
    );
    expect(() =>
      validateEnvironment({ NODE_ENV: 'development', DATABASE_URL: '' }),
    ).toThrow(/Missing mandatory environment configuration: DATABASE_URL/);
  });

  it('validates and applies default port 3100 and default CORS origin in development', () => {
    const config = validateEnvironment({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:admin@localhost:5432/promptlab',
    });

    expect(config.DATABASE_URL).toBe(
      'postgresql://postgres:admin@localhost:5432/promptlab',
    );
    expect(config.PORT).toBe(3100);
    expect(config.CORS_ORIGIN).toBe('http://localhost:4200');
    expect(config.LITELLM_GATEWAY_URL).toBe('http://127.0.0.1:4000');
    expect(config.LITELLM_MASTER_KEY).toBe(DEV_MASTER_KEY);
    expect(config.ENABLE_TELEMETRY).toBe(true);
    expect(config.IS_DEV_OR_TEST).toBe(true);
    expect(config.AUTH_DEV_TOKENS_ENABLED).toBe(false);
    expect(config.LLM_REQUEST_TIMEOUT_MS).toBe(30000);
    expect(config.QUOTA_TIMEOUT_CHARGE_RATIO).toBe(0.5);
    expect(config.MODEL_CATALOG_TTL_MS).toBe(300000);
  });

  it('parses custom PORT, CORS origins, and custom LLM_REQUEST_TIMEOUT_MS', () => {
    const config = validateEnvironment({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      PORT: '8080',
      CORS_ORIGIN: 'http://localhost:4200, https://promptlab.internal',
      LLM_REQUEST_TIMEOUT_MS: '45000',
    });

    expect(config.PORT).toBe(8080);
    expect(config.LLM_REQUEST_TIMEOUT_MS).toBe(45000);
    expect(config.CORS_ORIGIN).toEqual([
      'http://localhost:4200',
      'https://promptlab.internal',
    ]);
  });

  it('handles invalid numeric PORT by falling back safely to 3100', () => {
    const config = validateEnvironment({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      PORT: 'invalid-port',
    });

    expect(config.PORT).toBe(3100);
  });

  it('supports LITELLM_PROXY_URL fallback and LITELLM_GATEWAY_URL precedence', () => {
    const configWithProxyOnly = validateEnvironment({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      LITELLM_PROXY_URL: 'http://proxy.internal:4000',
    });
    expect(configWithProxyOnly.LITELLM_GATEWAY_URL).toBe(
      'http://proxy.internal:4000',
    );

    const configWithBoth = validateEnvironment({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      LITELLM_GATEWAY_URL: 'http://gateway.internal:4000',
      LITELLM_PROXY_URL: 'http://proxy.internal:4000',
    });
    expect(configWithBoth.LITELLM_GATEWAY_URL).toBe(
      'http://gateway.internal:4000',
    );
  });

  describe('Fail-closed when NODE_ENV is unset or not in allow-list', () => {
    it('treats unset NODE_ENV as production and refuses startup without real auth', () => {
      expect(() =>
        validateEnvironment({
          DATABASE_URL: 'postgresql://localhost:5432/promptlab',
          // NODE_ENV is unset
        }),
      ).toThrow(
        /LITELLM_MASTER_KEY must be set to a strong, unique secret in production/,
      );
    });

    it('treats arbitrary NODE_ENV (e.g. "staging") as production for security checks', () => {
      expect(() =>
        validateEnvironment({
          NODE_ENV: 'staging',
          DATABASE_URL: 'postgresql://localhost:5432/promptlab',
          LITELLM_MASTER_KEY: 'sk-prod-key-12345-at-least-32-chars-long!',
        }),
      ).toThrow(
        /In production, a secure authentication configuration is mandatory/,
      );
    });
  });

  describe('Known example secrets rejection in production-like environments', () => {
    const baseProdEnv = {
      DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      NODE_ENV: 'production',
    };

    it('rejects LITELLM_MASTER_KEY matching any known example secret', () => {
      for (const secret of KNOWN_EXAMPLE_SECRETS) {
        expect(() =>
          validateEnvironment({
            ...baseProdEnv,
            LITELLM_MASTER_KEY: secret,
            AUTH_JWT_SECRET: 'a-real-jwt-secret-that-is-at-least-32-characters-long',
          }),
        ).toThrow(/cannot use an insecure example/);
      }
    });

    it('rejects AUTH_JWT_SECRET matching any known example secret', () => {
      expect(() =>
        validateEnvironment({
          ...baseProdEnv,
          LITELLM_MASTER_KEY: 'strong-custom-production-litellm-master-key-xyz',
          AUTH_JWT_SECRET: 'promptlab-dev-jwt-secret-at-least-32-chars-long!',
        }),
      ).toThrow(/AUTH_JWT_SECRET cannot use an insecure example secret/);
    });

    it('rejects AUTH_API_KEYS matching any known example secret in production', () => {
      expect(() =>
        validateEnvironment({
          ...baseProdEnv,
          LITELLM_MASTER_KEY: 'strong-custom-production-litellm-master-key-xyz',
          AUTH_API_KEYS: 'dev-admin-key:admin-1:admin',
        }),
      ).toThrow();
    });
  });

  describe('Production key strength, malformed entries, and duplicates', () => {
    const baseProdEnv = {
      DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      NODE_ENV: 'production',
      LITELLM_MASTER_KEY: 'strong-production-master-key-32-chars-minimum!',
    };

    it('throws in production when an API key is shorter than 32 characters', () => {
      expect(() =>
        validateEnvironment({
          ...baseProdEnv,
          AUTH_API_KEYS: 'a:dev-user-001:admin',
        }),
      ).toThrow(
        /In production, each API key in AUTH_API_KEYS must be at least 32 characters long/,
      );
    });

    it('throws when AUTH_API_KEYS has a malformed entry (wrong number of parts)', () => {
      expect(() =>
        validateEnvironment({
          ...baseProdEnv,
          AUTH_API_KEYS: 'incomplete-entry:admin',
        }),
      ).toThrow(/Malformed AUTH_API_KEYS entry/);
    });

    it('throws when AUTH_API_KEYS has an invalid role', () => {
      expect(() =>
        validateEnvironment({
          ...baseProdEnv,
          AUTH_API_KEYS:
            'some-very-long-secret-key-that-exceeds-32-chars:user1:superadmin',
        }),
      ).toThrow(/Malformed AUTH_API_KEYS entry/);
    });

    it('throws when AUTH_API_KEYS has duplicate keys', () => {
      const longKey = 'repeated-secret-key-that-exceeds-32-chars-length';
      expect(() =>
        validateEnvironment({
          ...baseProdEnv,
          AUTH_API_KEYS: `${longKey}:user1:admin, ${longKey}:user2:user`,
        }),
      ).toThrow(/Duplicate API key detected in AUTH_API_KEYS/);
    });

    it('throws in production when AUTH_JWT_SECRET is shorter than 32 characters', () => {
      expect(() =>
        validateEnvironment({
          ...baseProdEnv,
          AUTH_JWT_SECRET: 'short-secret-under-32-chars',
        }),
      ).toThrow(
        /AUTH_JWT_SECRET must be at least 32 characters long in production/,
      );
    });

    it('succeeds in production with strong API keys (>= 32 chars)', () => {
      const strongKey = 'strong-production-api-key-for-admin-at-least-32-chars!';
      const config = validateEnvironment({
        ...baseProdEnv,
        AUTH_API_KEYS: `${strongKey}:admin-001:admin`,
      });
      expect(config.AUTH_API_KEYS.length).toBe(1);
      expect(config.AUTH_API_KEYS[0].user.id).toBe('admin-001');
    });

    it('succeeds in production with strong AUTH_JWT_SECRET (>= 32 chars)', () => {
      const strongJwt = 'super-secure-production-jwt-secret-min-32-chars-long!';
      const config = validateEnvironment({
        ...baseProdEnv,
        AUTH_JWT_SECRET: strongJwt,
      });
      expect(config.AUTH_JWT_SECRET).toBe(strongJwt);
    });
  });

  describe('Dev tokens configuration', () => {
    it('disables dev tokens when AUTH_DEV_TOKENS_ENABLED is false in development', () => {
      const config = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        AUTH_DEV_TOKENS_ENABLED: 'false',
        AUTH_DEV_ADMIN_TOKEN: 'dev-admin-token',
      });
      expect(config.AUTH_DEV_TOKENS_ENABLED).toBe(false);
      expect(config.AUTH_DEV_ADMIN_TOKEN).toBeUndefined();
    });

    it('disables dev tokens in production even if AUTH_DEV_TOKENS_ENABLED=true', () => {
      const strongKey = 'strong-production-api-key-for-admin-at-least-32-chars!';
      const config = validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        LITELLM_MASTER_KEY: 'strong-production-master-key-32-chars-minimum!',
        AUTH_API_KEYS: `${strongKey}:admin-001:admin`,
        AUTH_DEV_TOKENS_ENABLED: 'true',
        AUTH_DEV_ADMIN_TOKEN: 'some-token',
      });
      expect(config.AUTH_DEV_TOKENS_ENABLED).toBe(false);
      expect(config.AUTH_DEV_ADMIN_TOKEN).toBeUndefined();
    });

    it('does NOT apply literal fallbacks for dev tokens when tokens are omitted', () => {
      const config = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        AUTH_DEV_TOKENS_ENABLED: 'true',
        // AUTH_DEV_ADMIN_TOKEN and AUTH_DEV_USER_TOKEN omitted
      });
      expect(config.AUTH_DEV_TOKENS_ENABLED).toBe(true);
      expect(config.AUTH_DEV_ADMIN_TOKEN).toBeUndefined();
      expect(config.AUTH_DEV_USER_TOKEN).toBeUndefined();
    });
  });

  describe('TRUST_PROXY validation', () => {
    it('defaults TRUST_PROXY to false when unset or empty', () => {
      const config = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      });
      expect(config.TRUST_PROXY).toBe(false);

      const configEmpty = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        TRUST_PROXY: '   ',
      });
      expect(configEmpty.TRUST_PROXY).toBe(false);
    });

    it('resolves TRUST_PROXY to false when set to "false" or "0"', () => {
      const configFalse = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        TRUST_PROXY: 'false',
      });
      expect(configFalse.TRUST_PROXY).toBe(false);

      const configZero = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        TRUST_PROXY: '0',
      });
      expect(configZero.TRUST_PROXY).toBe(false);
    });

    it('rejects TRUST_PROXY="true" with startup error', () => {
      expect(() =>
        validateEnvironment({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://localhost:5432/promptlab',
          TRUST_PROXY: 'true',
        }),
      ).toThrow(/TRUST_PROXY="true" is insecure and disallowed/);
    });

    it('parses numeric TRUST_PROXY as hop count', () => {
      const config = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        TRUST_PROXY: '1',
      });
      expect(config.TRUST_PROXY).toBe(1);

      const config2 = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        TRUST_PROXY: '2',
      });
      expect(config2.TRUST_PROXY).toBe(2);
    });

    it('accepts IP or CIDR strings for TRUST_PROXY', () => {
      const configCidr = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        TRUST_PROXY: '10.0.0.0/8',
      });
      expect(configCidr.TRUST_PROXY).toBe('10.0.0.0/8');

      const configIp = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        TRUST_PROXY: '127.0.0.1, 192.168.1.1',
      });
      expect(configIp.TRUST_PROXY).toBe('127.0.0.1, 192.168.1.1');
    });
  });

  describe('ENABLE_TELEMETRY validation', () => {
    it('defaults ENABLE_TELEMETRY to true when unset', () => {
      const config = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      });
      expect(config.ENABLE_TELEMETRY).toBe(true);
    });

    it('sets ENABLE_TELEMETRY to false when ENABLE_TELEMETRY is "false"', () => {
      const config = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        ENABLE_TELEMETRY: 'false',
      });
      expect(config.ENABLE_TELEMETRY).toBe(false);
    });

    it('sets ENABLE_TELEMETRY to true when ENABLE_TELEMETRY is "true"', () => {
      const config = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        ENABLE_TELEMETRY: 'true',
      });
      expect(config.ENABLE_TELEMETRY).toBe(true);
    });

    it('falls back to TELEMETRY_ENABLED when ENABLE_TELEMETRY is unset', () => {
      const config = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        TELEMETRY_ENABLED: 'false',
      });
      expect(config.ENABLE_TELEMETRY).toBe(false);
    });
  });

  describe('QUOTA_TIMEOUT_CHARGE_RATIO validation', () => {
    it('defaults QUOTA_TIMEOUT_CHARGE_RATIO to 0.5 when unset', () => {
      const config = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
      });
      expect(config.QUOTA_TIMEOUT_CHARGE_RATIO).toBe(0.5);
    });

    it('accepts valid floating-point numbers between 0.0 and 1.0', () => {
      const c0 = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        QUOTA_TIMEOUT_CHARGE_RATIO: '0',
      });
      expect(c0.QUOTA_TIMEOUT_CHARGE_RATIO).toBe(0);

      const c25 = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        QUOTA_TIMEOUT_CHARGE_RATIO: '0.25',
      });
      expect(c25.QUOTA_TIMEOUT_CHARGE_RATIO).toBe(0.25);

      const c1 = validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        QUOTA_TIMEOUT_CHARGE_RATIO: '1.0',
      });
      expect(c1.QUOTA_TIMEOUT_CHARGE_RATIO).toBe(1.0);
    });

    it('throws on non-numeric or out-of-range ratio values', () => {
      expect(() =>
        validateEnvironment({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://localhost:5432/promptlab',
          QUOTA_TIMEOUT_CHARGE_RATIO: '-0.1',
        }),
      ).toThrow(/Invalid QUOTA_TIMEOUT_CHARGE_RATIO/);

      expect(() =>
        validateEnvironment({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://localhost:5432/promptlab',
          QUOTA_TIMEOUT_CHARGE_RATIO: '1.5',
        }),
      ).toThrow(/Invalid QUOTA_TIMEOUT_CHARGE_RATIO/);

      expect(() =>
        validateEnvironment({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://localhost:5432/promptlab',
          QUOTA_TIMEOUT_CHARGE_RATIO: 'invalid-ratio',
        }),
      ).toThrow(/Invalid QUOTA_TIMEOUT_CHARGE_RATIO/);
    });

    describe('MODEL_CATALOG_TTL_MS & LITELLM_BASE_URL', () => {
      it('parses custom positive integer MODEL_CATALOG_TTL_MS', () => {
        const config = validateEnvironment({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://localhost:5432/promptlab',
          MODEL_CATALOG_TTL_MS: '60000',
        });
        expect(config.MODEL_CATALOG_TTL_MS).toBe(60000);
      });

      it('throws on negative, zero, or non-numeric MODEL_CATALOG_TTL_MS', () => {
        expect(() =>
          validateEnvironment({
            NODE_ENV: 'development',
            DATABASE_URL: 'postgresql://localhost:5432/promptlab',
            MODEL_CATALOG_TTL_MS: '-5000',
          }),
        ).toThrow(/Invalid MODEL_CATALOG_TTL_MS/);

        expect(() =>
          validateEnvironment({
            NODE_ENV: 'development',
            DATABASE_URL: 'postgresql://localhost:5432/promptlab',
            MODEL_CATALOG_TTL_MS: '0',
          }),
        ).toThrow(/Invalid MODEL_CATALOG_TTL_MS/);

        expect(() =>
          validateEnvironment({
            NODE_ENV: 'development',
            DATABASE_URL: 'postgresql://localhost:5432/promptlab',
            MODEL_CATALOG_TTL_MS: 'not-a-number',
          }),
        ).toThrow(/Invalid MODEL_CATALOG_TTL_MS/);
      });

      it('defaults MODEL_CATALOG_FAILURE_BACKOFF_MS to 30000 and parses valid positive integers', () => {
        const configDefault = validateEnvironment({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://localhost:5432/promptlab',
        });
        expect(configDefault.MODEL_CATALOG_FAILURE_BACKOFF_MS).toBe(30000);

        const configCustom = validateEnvironment({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://localhost:5432/promptlab',
          MODEL_CATALOG_FAILURE_BACKOFF_MS: '15000',
        });
        expect(configCustom.MODEL_CATALOG_FAILURE_BACKOFF_MS).toBe(15000);
      });

      it('rejects invalid MODEL_CATALOG_FAILURE_BACKOFF_MS values', () => {
        expect(() =>
          validateEnvironment({
            NODE_ENV: 'development',
            DATABASE_URL: 'postgresql://localhost:5432/promptlab',
            MODEL_CATALOG_FAILURE_BACKOFF_MS: '-5000',
          }),
        ).toThrow(/Invalid MODEL_CATALOG_FAILURE_BACKOFF_MS/);

        expect(() =>
          validateEnvironment({
            NODE_ENV: 'development',
            DATABASE_URL: 'postgresql://localhost:5432/promptlab',
            MODEL_CATALOG_FAILURE_BACKOFF_MS: '0',
          }),
        ).toThrow(/Invalid MODEL_CATALOG_FAILURE_BACKOFF_MS/);

        expect(() =>
          validateEnvironment({
            NODE_ENV: 'development',
            DATABASE_URL: 'postgresql://localhost:5432/promptlab',
            MODEL_CATALOG_FAILURE_BACKOFF_MS: 'not-a-number',
          }),
        ).toThrow(/Invalid MODEL_CATALOG_FAILURE_BACKOFF_MS/);
      });

      it('supports LITELLM_BASE_URL as fallback for LITELLM_GATEWAY_URL', () => {
        const config = validateEnvironment({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://localhost:5432/promptlab',
          LITELLM_BASE_URL: 'http://base-gateway.internal:4000',
        });
        expect(config.LITELLM_GATEWAY_URL).toBe('http://base-gateway.internal:4000');
      });
    });
  });
});

