import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG, ValidatedEnvironment } from '../common/config/env.validation';
import { ModelCatalogService } from '../providers/model-catalog.service';

export interface HealthCheckResult {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  version: string;
  services: {
    database: {
      status: 'connected' | 'disconnected';
      latencyMs: number;
      error?: string;
    };
    gateway: {
      url: string;
      serviceAvailability: 'available' | 'unreachable' | 'not_configured';
      latencyMs?: number;
      providerReadiness: {
        status: 'ready' | 'missing_provider_credentials';
        configuredProviders: string[];
      };
    };
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();
  static readonly GATEWAY_PROBE_TIMEOUT_MS = 1200;

  constructor(
    @Inject(APP_CONFIG) private readonly appConfig: ValidatedEnvironment,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly modelCatalog: ModelCatalogService,
  ) {}

  async getHealth(): Promise<HealthCheckResult> {
    const rawLitellmUrl = this.appConfig.LITELLM_GATEWAY_URL;
    const environment = this.appConfig.NODE_ENV;

    const [dbHealth, gatewayHealth] = await Promise.all([
      this.checkDatabase(),
      this.checkGateway(rawLitellmUrl),
    ]);

    // Database connectivity is required for core health; gateway reaches degraded if DB is down
    const overallStatus: 'ok' | 'degraded' = dbHealth.status === 'connected' ? 'ok' : 'degraded';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      environment,
      version: this.appConfig.APP_VERSION,
      services: {
        database: dbHealth,
        gateway: {
          url: rawLitellmUrl,
          ...gatewayHealth,
        },
      },
    };
  }

  /** Database connectivity (used by both the diagnostic endpoint and the readiness probe). */
  async checkDatabase(): Promise<HealthCheckResult['services']['database']> {
    return this.prisma.checkHealth();
  }

  /**
   * Gateway liveness only (no catalog lookup), for the readiness probe.
   * Each fetch gets its own timeout signal: the previous implementation reused one
   * AbortController for the fallback request, so after the first call timed out the
   * fallback was born already aborted and could never succeed.
   */
  async checkGatewayLiveness(
    url: string | undefined = this.appConfig.LITELLM_GATEWAY_URL,
  ): Promise<{ serviceAvailability: 'available' | 'unreachable' | 'not_configured'; latencyMs?: number }> {
    if (!url) {
      return { serviceAvailability: 'not_configured' };
    }

    const targetUrl = url.replace(/\/$/, '');
    const start = Date.now();
    // 401/403/404 still prove the gateway process is up and answering HTTP.
    const answered = (response: Response) =>
      response.ok || response.status === 401 || response.status === 403 || response.status === 404;

    for (const path of ['/health/liveliness', '/health']) {
      try {
        const response = await fetch(`${targetUrl}${path}`, {
          signal: AbortSignal.timeout(HealthService.GATEWAY_PROBE_TIMEOUT_MS),
        });
        if (answered(response)) {
          return { serviceAvailability: 'available', latencyMs: Date.now() - start };
        }
      } catch {
        // Try the next path; report unreachable only if every probe fails.
      }
    }

    return { serviceAvailability: 'unreachable', latencyMs: Date.now() - start };
  }

  private async checkGateway(url?: string): Promise<{
    serviceAvailability: 'available' | 'unreachable' | 'not_configured';
    latencyMs?: number;
    providerReadiness: {
      status: 'ready' | 'missing_provider_credentials';
      configuredProviders: string[];
    };
  }> {
    const [configuredProviders, liveness] = await Promise.all([
      this.modelCatalog.getConfiguredProviders().catch(() => [] as string[]),
      this.checkGatewayLiveness(url),
    ]);

    return {
      ...liveness,
      providerReadiness: {
        status: configuredProviders.length > 0 ? 'ready' : 'missing_provider_credentials',
        configuredProviders,
      },
    };
  }
}
