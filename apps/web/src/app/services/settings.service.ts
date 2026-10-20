import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SystemSettings {
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
    authMode: string;
    defaultUser: string;
    corsOrigins: string | string[];
    secretsExposed: boolean;
  };
}

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private readonly baseUrl = '/api/settings';

  constructor(private readonly http: HttpClient) {}

  getSettings(): Observable<SystemSettings> {
    return this.http.get<SystemSettings>(this.baseUrl);
  }
}
