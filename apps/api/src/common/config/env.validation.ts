import * as crypto from 'crypto';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';

export const DEFAULT_LITELLM_GATEWAY_URL = 'http://127.0.0.1:4000';

/** The insecure dev-only master key. Never acceptable in production. */
export const DEV_MASTER_KEY = 'sk-promptlab-dev-key';

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
  AUTH_DEV_TOKENS_ENABLED: boolean;
  AUTH_DEV_ADMIN_TOKEN?: string;
  AUTH_DEV_USER_TOKEN?: string;
  AUTH_JWT_SECRET?: string;
  AUTH_API_KEYS: ParsedApiKey[];
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  LANGFUSE_HOST?: string;
}

/**
 * Parses comma-separated API keys in format `<key>:<userId>:<role>`.
 * Returns parsed entries with SHA-256 digests for timing-safe comparison.
 */
export function parseApiKeys(raw: string | undefined): ParsedApiKey[] {
  if (!raw || !raw.trim()) return [];
  const entries = raw.split(',').map((e) => e.trim()).filter(Boolean);
  const keys: ParsedApiKey[] = [];
  for (const entry of entries) {
    const parts = entry.split(':');
    if (parts.length >= 3) {
      const [key, userId, role] = parts;
      if (key && userId && (role === 'admin' || role === 'user')) {
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
    }
  }
  return keys;
}

/**
 * Validates required and optional runtime environment variables at application startup.
 * Throws a clear, informative error if mandatory variables are missing or insecure for production.
 */
export function validateEnvironment(
  env: Record<string, string | undefined> = process.env,
): ValidatedEnvironment {
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

  const isProduction = env.NODE_ENV === 'production';
  const masterKey = env.LITELLM_MASTER_KEY;
  if (isProduction && (!masterKey || masterKey === DEV_MASTER_KEY)) {
    throw new Error(
      '[Startup Error] LITELLM_MASTER_KEY must be set to a strong, unique secret in production. ' +
        'The default dev key "sk-promptlab-dev-key" is not acceptable.',
    );
  }

  // SEC-01a: Production startup validation for authentication
  const parsedApiKeys = parseApiKeys(env.AUTH_API_KEYS);
  const jwtSecret = env.AUTH_JWT_SECRET?.trim();
  const hasApiKeys = parsedApiKeys.length > 0;
  const hasJwtSecret = Boolean(jwtSecret && jwtSecret.length >= 32);

  if (isProduction) {
    if (jwtSecret && jwtSecret.length < 32) {
      throw new Error(
        '[Startup Error] AUTH_JWT_SECRET must be at least 32 characters long in production.',
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
    ? rawCors.split(',').map((o) => o.trim()).filter(Boolean)
    : rawCors.trim();

  const authDevTokensEnabled =
    !isProduction && env.AUTH_DEV_TOKENS_ENABLED === 'true';

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
    NODE_ENV: env.NODE_ENV || 'development',
    AUTH_DEV_TOKENS_ENABLED: authDevTokensEnabled,
    AUTH_DEV_ADMIN_TOKEN: authDevTokensEnabled
      ? env.AUTH_DEV_ADMIN_TOKEN || 'dev-admin-token'
      : undefined,
    AUTH_DEV_USER_TOKEN: authDevTokensEnabled
      ? env.AUTH_DEV_USER_TOKEN || 'dev-user-token'
      : undefined,
    AUTH_JWT_SECRET: jwtSecret,
    AUTH_API_KEYS: parsedApiKeys,
    OTEL_EXPORTER_OTLP_ENDPOINT: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    LANGFUSE_HOST: env.LANGFUSE_HOST,
  };
}
