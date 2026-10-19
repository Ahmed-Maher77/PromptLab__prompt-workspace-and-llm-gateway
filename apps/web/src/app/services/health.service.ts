import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';

export interface HealthResponse {
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

@Injectable({
  providedIn: 'root',
})
export class HealthService {
  private readonly apiUrl = '/api/health';

  constructor(private http: HttpClient) {}

  getHealth(): Observable<HealthResponse | null> {
    return this.http.get<HealthResponse>(this.apiUrl).pipe(
      catchError((error) => {
        console.error('Failed to query API health endpoint:', error);
        return of(null);
      })
    );
  }
}
