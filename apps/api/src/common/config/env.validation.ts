export const DEFAULT_LITELLM_GATEWAY_URL = 'http://127.0.0.1:4000';

/** The insecure dev-only master key. Never acceptable in production. */
export const DEV_MASTER_KEY = 'sk-promptlab-dev-key';

export interface ValidatedEnvironment {
  DATABASE_URL: string;
  PORT: number;
  CORS_ORIGIN: string | string[];
  LITELLM_GATEWAY_URL: string;
  LITELLM_MASTER_KEY: string;
  TELEMETRY_ENABLED: boolean;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  LANGFUSE_HOST?: string;
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

  // Fail fast in production when LITELLM_MASTER_KEY is missing or uses the insecure dev default.
  const isProduction = env.NODE_ENV === 'production';
  const masterKey = env.LITELLM_MASTER_KEY;
  if (isProduction && (!masterKey || masterKey === DEV_MASTER_KEY)) {
    throw new Error(
      '[Startup Error] LITELLM_MASTER_KEY must be set to a strong, unique secret in production. ' +
        'The default dev key "sk-promptlab-dev-key" is not acceptable.',
    );
  }

  const rawPort = env.PORT ? parseInt(env.PORT, 10) : 3100;
  const port = isNaN(rawPort) || rawPort <= 0 ? 3100 : rawPort;

  const rawCors = env.CORS_ORIGIN || 'http://localhost:4200';
  const corsOrigins = rawCors.includes(',')
    ? rawCors.split(',').map((o) => o.trim()).filter(Boolean)
    : rawCors.trim();

  return {
    DATABASE_URL: env.DATABASE_URL!,
    PORT: port,
    CORS_ORIGIN: corsOrigins,
    LITELLM_GATEWAY_URL: env.LITELLM_GATEWAY_URL || env.LITELLM_PROXY_URL || DEFAULT_LITELLM_GATEWAY_URL,
    LITELLM_MASTER_KEY: masterKey ?? DEV_MASTER_KEY,
    TELEMETRY_ENABLED: env.TELEMETRY_ENABLED !== 'false',
    OTEL_EXPORTER_OTLP_ENDPOINT: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    LANGFUSE_HOST: env.LANGFUSE_HOST,
  };
}
