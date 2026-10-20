import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_LITELLM_GATEWAY_URL } from '../common/config/env.validation';

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

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async getHealth(): Promise<HealthCheckResult> {
    const dbHealth = await this.prisma.checkHealth();
    const rawLitellmUrl =
      this.configService.get<string>('LITELLM_GATEWAY_URL') ||
      this.configService.get<string>('LITELLM_PROXY_URL') ||
      DEFAULT_LITELLM_GATEWAY_URL;
    const environment = this.configService.get<string>('NODE_ENV', 'development');

    const gatewayHealth = await this.checkGateway(rawLitellmUrl);

    // Database connectivity is required for core health; gateway reaches degraded if DB is down
    const overallStatus: 'ok' | 'degraded' = dbHealth.status === 'connected' ? 'ok' : 'degraded';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      environment,
      version: '0.1.0',
      services: {
        database: dbHealth,
        gateway: {
          url: rawLitellmUrl,
          ...gatewayHealth,
        },
      },
    };
  }

  private async checkGateway(url?: string): Promise<{
    serviceAvailability: 'available' | 'unreachable' | 'not_configured';
    latencyMs?: number;
    providerReadiness: {
      status: 'ready' | 'missing_provider_credentials';
      configuredProviders: string[];
    };
  }> {
    const configuredProviders: string[] = [];
    if (this.configService.get<string>('OPENAI_API_KEY')) configuredProviders.push('openai');
    if (this.configService.get<string>('ANTHROPIC_API_KEY')) configuredProviders.push('anthropic');
    if (this.configService.get<string>('GEMINI_API_KEY')) configuredProviders.push('gemini');

    const providerReadiness = {
      status: configuredProviders.length > 0 ? ('ready' as const) : ('missing_provider_credentials' as const),
      configuredProviders,
    };

    if (!url) {
      return {
        serviceAvailability: 'not_configured',
        providerReadiness,
      };
    }

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);

      const targetUrl = url.replace(/\/$/, '');
      const response = await fetch(`${targetUrl}/health/liveliness`, {
        signal: controller.signal,
      }).catch(async () => {
        return await fetch(`${targetUrl}/health`, {
          signal: controller.signal,
        });
      }).finally(() => {
        clearTimeout(timeoutId);
      });

      const isAvailable =
        response && (response.ok || response.status === 401 || response.status === 403 || response.status === 404);

      return {
        serviceAvailability: isAvailable ? 'available' : 'unreachable',
        latencyMs: Date.now() - start,
        providerReadiness,
      };
    } catch {
      return {
        serviceAvailability: 'unreachable',
        latencyMs: Date.now() - start,
        providerReadiness,
      };
    }
  }
}
