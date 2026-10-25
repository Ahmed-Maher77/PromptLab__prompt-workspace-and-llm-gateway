import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { UsageService } from '../usage/usage.service';
import { ObservabilityService } from '../observability/observability.service';
import { DEFAULT_DEV_USER } from '../common/constants/auth.constants';
import { APP_CONFIG, ValidatedEnvironment } from '../common/config/env.validation';

export interface SystemSettingsResponse {
  application: {
    name: string;
    version: string;
    environment: string;
    nodeVersion: string;
    uptimeSeconds: number;
    platform: string;
  };
  gateway: {
    url: string;
    connected: boolean;
    modelsConfigured: number;
    models: Array<{
      id: string;
      provider: string;
      name: string;
    }>;
    error?: string;
  };
  database: {
    type: 'PostgreSQL';
    connected: boolean;
    latencyMs: number;
  };
  quotaPolicy: {
    scope: string;
    scopeId: string;
    monthlyTokenLimit: number;
    requestRateLimit: number;
    effectiveFrom: string;
  };
  observability: {
    telemetryEnabled: boolean;
    otelConfigured: boolean;
    otelEndpoint: string | null;
    langfuseConfigured: boolean;
    langfuseHost: string | null;
    privacyRedactionActive: boolean;
    tracesRecorded: number;
  };
  security: {
    authMode: 'single-tenant-developer';
    defaultUser: string;
    corsOrigins: string | string[];
    secretsExposed: false;
  };
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly appConfig: ValidatedEnvironment,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly providersService: ProvidersService,
    private readonly usageService: UsageService,
    private readonly observabilityService: ObservabilityService,
  ) {}

  async getSettings(): Promise<SystemSettingsResponse> {
    // 1. Live gateway connectivity and configured models
    const modelResult = await this.providersService.listModels();

    // 2. Database health
    const dbHealth = await this.prisma.checkHealth();

    // 3. Quota policy
    let quotaPolicy: SystemSettingsResponse['quotaPolicy'] = {
      scope: 'user',
      scopeId: DEFAULT_DEV_USER.id,
      monthlyTokenLimit: 100_000,
      requestRateLimit: 60,
      effectiveFrom: new Date().toISOString(),
    };
    if (this.usageService) {
      try {
        const policy = await this.usageService.getPolicy(DEFAULT_DEV_USER.id);
        quotaPolicy = {
          scope: policy.scope,
          scopeId: policy.scopeId,
          monthlyTokenLimit: policy.monthlyTokenLimit,
          requestRateLimit: policy.requestRateLimit,
          effectiveFrom: policy.effectiveFrom ? new Date(policy.effectiveFrom).toISOString() : new Date().toISOString(),
        };
      } catch (err) {
        this.logger.warn(`Could not fetch quota policy for settings: ${err}`);
      }
    }

    // 4. Observability status
    let obsStatus = {
      telemetryEnabled: true,
      otelConfigured: false,
      otelEndpoint: null as string | null,
      langfuseConfigured: false,
      langfuseHost: null as string | null,
      privacyRedactionActive: true,
      tracesRecorded: 0,
    };
    if (this.observabilityService) {
      try {
        const status = this.observabilityService.getStatus();
        obsStatus = {
          telemetryEnabled: status.telemetryEnabled,
          otelConfigured: status.otelConfigured,
          otelEndpoint: status.otelEndpoint ? this.maskHost(status.otelEndpoint) : null,
          langfuseConfigured: status.langfuseConfigured,
          langfuseHost: status.langfuseHost ? this.maskHost(status.langfuseHost) : null,
          privacyRedactionActive: status.privacyRedactionActive,
          tracesRecorded: status.totalTracesRecorded,
        };
      } catch (err) {
        this.logger.warn(`Could not fetch observability status for settings: ${err}`);
      }
    }

    return {
      application: {
        name: 'PromptLab',
        version: this.appConfig.APP_VERSION,
        environment: this.appConfig.NODE_ENV,
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        platform: process.platform,
      },
      gateway: {
        url: this.providersService.getGatewayUrl(),
        connected: modelResult.gatewayConnected,
        modelsConfigured: modelResult.models.length,
        models: modelResult.models.map((m) => ({
          id: m.id,
          provider: m.provider,
          name: m.name,
        })),
        error: modelResult.error,
      },
      database: {
        type: 'PostgreSQL',
        connected: dbHealth.status === 'connected',
        latencyMs: dbHealth.latencyMs,
      },
      quotaPolicy,
      observability: obsStatus,
      security: {
        authMode: 'single-tenant-developer',
        defaultUser: `${DEFAULT_DEV_USER.id} (${DEFAULT_DEV_USER.displayName})`,
        corsOrigins: this.appConfig.CORS_ORIGIN,
        secretsExposed: false,
      },
    };
  }

  /**
   * Masks sensitive credentials or query parameters from a URL, preserving only protocol and host.
   */
  private maskHost(urlStr: string): string {
    try {
      const parsed = new URL(urlStr);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return urlStr;
    }
  }
}
