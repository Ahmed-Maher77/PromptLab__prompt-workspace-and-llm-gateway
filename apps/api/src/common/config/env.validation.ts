export const DEFAULT_LITELLM_GATEWAY_URL = 'http://127.0.0.1:4000';

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
 * Throws a clear, informative error if mandatory variables are missing.
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
    LITELLM_MASTER_KEY: env.LITELLM_MASTER_KEY || 'sk-promptlab-dev-key',
    TELEMETRY_ENABLED: env.TELEMETRY_ENABLED !== 'false',
    OTEL_EXPORTER_OTLP_ENDPOINT: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    LANGFUSE_HOST: env.LANGFUSE_HOST,
  };
}
