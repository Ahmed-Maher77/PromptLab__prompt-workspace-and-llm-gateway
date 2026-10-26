import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckResult as TerminusResult, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { HealthService, HealthCheckResult } from './health.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * HEALTH-01: three endpoints with distinct contracts.
 *
 * - GET /api/health        Diagnostic status for the UI. Always 200 while the process can answer;
 *                          the body carries `status: 'ok' | 'degraded'` plus per-dependency detail.
 *                          The Overview page renders this body, so a 503 here would blank the page.
 * - GET /api/health/live   Liveness probe: the process is up and serving HTTP. No dependency checks,
 *                          so a database or gateway outage never causes a container restart loop.
 * - GET /api/health/ready  Readiness probe: 200 only when the database and the LiteLLM gateway are
 *                          reachable; 503 (Terminus error body) otherwise. For load balancers.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
  ) {}

  @Public()
  @Get()
  async check(): Promise<HealthCheckResult> {
    return this.healthService.getHealth();
  }

  @Public()
  @Get('live')
  @HealthCheck()
  live(): Promise<TerminusResult> {
    return this.health.check([]);
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  ready(): Promise<TerminusResult> {
    return this.health.check([
      async () => {
        const session = this.indicators.check('database');
        const db = await this.healthService.checkDatabase();
        return db.status === 'connected'
          ? session.up({ latencyMs: db.latencyMs })
          : session.down({ latencyMs: db.latencyMs, error: db.error ?? 'Database unreachable' });
      },
      async () => {
        const session = this.indicators.check('gateway');
        const gateway = await this.healthService.checkGatewayLiveness();
        return gateway.serviceAvailability === 'available'
          ? session.up({ latencyMs: gateway.latencyMs })
          : session.down({ latencyMs: gateway.latencyMs, availability: gateway.serviceAvailability });
      },
    ]);
  }
}
