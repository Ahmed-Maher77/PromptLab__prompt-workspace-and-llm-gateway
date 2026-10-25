import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';

export const DEFAULT_LITELLM_GATEWAY_URL = 'http://127.0.0.1:4000';

/** The insecure dev-only master key. Never acceptable in production or non-dev environments. */
export const DEV_MASTER_KEY = 'sk-promptlab-dev-key';

/**
 * List of known sample and example secrets that must be rejected in production-like environments.
 */
export const KNOWN_EXAMPLE_SECRETS: readonly string[] = Object.freeze([
  'sk-promptlab-dev-key',
  'promptlab-dev-jwt-secret-at-least-32-chars-long!',
  'dev-admin-key',
  'dev-user-key',
  'dev-admin-token',
  'dev-user-token',
]);

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

export interface ParsedApiKey {
  digest: Buffer;
  user: AuthenticatedUser;
}

export interface ValidatedEnvironment {
  DATABASE_URL: string;
  PORT: number;
  CORS_ORIGIN: string | string[];
  LITELLM_GATEWAY_URL: string;
  LITELLM_MASTER_KEY: string;
  TELEMETRY_ENABLED: boolean;
  NODE_ENV: string;
  IS_DEV_OR_TEST: boolean;
  AUTH_DEV_TOKENS_ENABLED: boolean;
  AUTH_DEV_ADMIN_TOKEN?: string;
  AUTH_DEV_USER_TOKEN?: string;
  AUTH_JWT_SECRET?: string;
  AUTH_JWT_ISSUER?: string;
  AUTH_JWT_AUDIENCE?: string;
  AUTH_JWT_MAX_LIFETIME_SECONDS: number;
  AUTH_API_KEYS: ParsedApiKey[];
  ENABLE_DEMO_ENDPOINTS: boolean;
  TRUST_PROXY?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  LANGFUSE_HOST?: string;
}

/**
 * Parses comma-separated API keys in format `<key>:<userId>:<role>`.
 * Throws on malformed entries, duplicates, or insecure keys in production.
 */
export function parseApiKeys(
  raw: string | undefined,
  isProductionLike: boolean = false,
): ParsedApiKey[] {
  if (!raw || !raw.trim()) return [];
  const entries = raw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  const keys: ParsedApiKey[] = [];
  const seenKeys = new Set<string>();

  for (const entry of entries) {
    const parts = entry.split(':').map((p) => p.trim());
    if (parts.length !== 3) {
      throw new Error(
        `[Startup Error] Malformed AUTH_API_KEYS entry: "${entry}". Format must be <key>:<userId>:<role> where role is 'admin' or 'user'.`,
      );
    }

    const [key, userId, role] = parts;
    if (!key || !userId || (role !== 'admin' && role !== 'user')) {
      throw new Error(
        `[Startup Error] Malformed AUTH_API_KEYS entry: "${entry}". Format must be <key>:<userId>:<role> where role is 'admin' or 'user'.`,
      );
    }

    if (seenKeys.has(key)) {
      throw new Error(
        `[Startup Error] Duplicate API key detected in AUTH_API_KEYS. Each configured key must be unique.`,
      );
    }
    seenKeys.add(key);

    if (isProductionLike) {
      if (key.length < 32) {
        throw new Error(
          `[Startup Error] In production, each API key in AUTH_API_KEYS must be at least 32 characters long. Key for user "${userId}" has length ${key.length}.`,
        );
      }
      if (KNOWN_EXAMPLE_SECRETS.includes(key)) {
        throw new Error(
          `[Startup Error] In production, API key cannot use an insecure example or default secret ("${key}").`,
        );
      }
    }

    keys.push({
      digest: crypto.createHash('sha256').update(key).digest(),
      user: {
        id: userId,
        email: `${userId}@promptlab.local`,
        displayName: userId === 'dev-user-001' ? 'Developer Admin' : userId,
        role: role as 'admin' | 'user',
      },
    });
  }
  return keys;
}

/**
 * Validates required and optional runtime environment variables at application startup.
 * SEC-01a-2: Treats any environment other than 'development' or 'test' (including unset)
 * as production-like for all security guarantees (fail-safe default).
 */
export function validateEnvironment(
  env: Record<string, string | undefined> = process.env,
): ValidatedEnvironment {
  const logger = new Logger('EnvironmentValidation');
  const missing: string[] = [];

  if (!env.DATABASE_URL || env.DATABASE_URL.trim() === '') {
    missing.push('DATABASE_URL');
  }

  if (missing.length > 0) {
    throw new Error(
      `[Startup Error] Missing mandatory environment configuration: ${missing.join(', ')}. ` +
        `Please copy .env.example to .env and configure all required variables.`,
    );
  }

  // SEC-01a-2: Allow-list for development and test. Everything else is treated as production.
  const rawNodeEnv = env.NODE_ENV?.trim();
  const isDevOrTest = rawNodeEnv === 'development' || rawNodeEnv === 'test';
  const isProductionLike = !isDevOrTest;

  const masterKey = env.LITELLM_MASTER_KEY?.trim();
  if (isProductionLike) {
    if (!masterKey || masterKey === '') {
      throw new Error(
        '[Startup Error] LITELLM_MASTER_KEY must be set to a strong, unique secret in production.',
      );
    }
    if (KNOWN_EXAMPLE_SECRETS.includes(masterKey)) {
      throw new Error(
        `[Startup Error] LITELLM_MASTER_KEY cannot use an insecure example secret ("${masterKey}") in production.`,
      );
    }
  }

  // SEC-01a-2: Production startup validation for authentication
  const parsedApiKeys = parseApiKeys(env.AUTH_API_KEYS, isProductionLike);
  const jwtSecret = env.AUTH_JWT_SECRET?.trim();
  const hasApiKeys = parsedApiKeys.length > 0;
  const hasJwtSecret = Boolean(jwtSecret && jwtSecret.length >= 32);

  if (isProductionLike) {
    if (jwtSecret && jwtSecret.length < 32) {
      throw new Error(
        '[Startup Error] AUTH_JWT_SECRET must be at least 32 characters long in production.',
      );
    }
    if (jwtSecret && KNOWN_EXAMPLE_SECRETS.includes(jwtSecret)) {
      throw new Error(
        '[Startup Error] AUTH_JWT_SECRET cannot use an insecure example secret in production.',
      );
    }
    if (!hasApiKeys && !hasJwtSecret) {
      throw new Error(
        '[Startup Error] In production, a secure authentication configuration is mandatory. ' +
          'Configure AUTH_API_KEYS or AUTH_JWT_SECRET (minimum 32 characters).',
      );
    }
  }

  const rawPort = env.PORT ? parseInt(env.PORT, 10) : 3100;
  const port = isNaN(rawPort) || rawPort <= 0 ? 3100 : rawPort;

  const rawCors = env.CORS_ORIGIN || 'http://localhost:4200';
  const corsOrigins = rawCors.includes(',')
    ? rawCors
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : rawCors.trim();

  // SEC-01a-2: Dev tokens work ONLY when isDevOrTest AND AUTH_DEV_TOKENS_ENABLED is strictly 'true'
  const authDevTokensEnabled =
    isDevOrTest && env.AUTH_DEV_TOKENS_ENABLED === 'true';

  let devAdminToken: string | undefined;
  let devUserToken: string | undefined;

  if (authDevTokensEnabled) {
    devAdminToken = env.AUTH_DEV_ADMIN_TOKEN?.trim() || undefined;
    devUserToken = env.AUTH_DEV_USER_TOKEN?.trim() || undefined;

    if (!devAdminToken && !devUserToken) {
      logger.warn(
        'AUTH_DEV_TOKENS_ENABLED is true, but neither AUTH_DEV_ADMIN_TOKEN nor AUTH_DEV_USER_TOKEN is set. No dev tokens will be accepted.',
      );
    }
  }

  const maxLifetimeRaw = env.AUTH_JWT_MAX_LIFETIME_SECONDS
    ? parseInt(env.AUTH_JWT_MAX_LIFETIME_SECONDS, 10)
    : 86400;
  const authJwtMaxLifetimeSeconds =
    !isNaN(maxLifetimeRaw) && maxLifetimeRaw > 0 ? maxLifetimeRaw : 86400;

  return {
    DATABASE_URL: env.DATABASE_URL!,
    PORT: port,
    CORS_ORIGIN: corsOrigins,
    LITELLM_GATEWAY_URL:
      env.LITELLM_GATEWAY_URL ||
      env.LITELLM_PROXY_URL ||
      DEFAULT_LITELLM_GATEWAY_URL,
    LITELLM_MASTER_KEY: masterKey ?? DEV_MASTER_KEY,
    TELEMETRY_ENABLED: env.TELEMETRY_ENABLED !== 'false',
    NODE_ENV: rawNodeEnv || 'production', // default to production when unset for security
    IS_DEV_OR_TEST: isDevOrTest,
    AUTH_DEV_TOKENS_ENABLED: authDevTokensEnabled,
    AUTH_DEV_ADMIN_TOKEN: devAdminToken,
    AUTH_DEV_USER_TOKEN: devUserToken,
    AUTH_JWT_SECRET: jwtSecret,
    AUTH_JWT_ISSUER: env.AUTH_JWT_ISSUER?.trim() || undefined,
    AUTH_JWT_AUDIENCE: env.AUTH_JWT_AUDIENCE?.trim() || undefined,
    AUTH_JWT_MAX_LIFETIME_SECONDS: authJwtMaxLifetimeSeconds,
    AUTH_API_KEYS: parsedApiKeys,
    ENABLE_DEMO_ENDPOINTS: isDevOrTest && env.ENABLE_DEMO_ENDPOINTS === 'true',
    TRUST_PROXY: env.TRUST_PROXY?.trim() || '1',
    OTEL_EXPORTER_OTLP_ENDPOINT: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    LANGFUSE_HOST: env.LANGFUSE_HOST,
  };
}
