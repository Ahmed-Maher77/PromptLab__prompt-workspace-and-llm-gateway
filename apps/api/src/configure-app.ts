import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { ValidatedEnvironment } from './common/config/env.validation';
import { requestIdHandler } from './common/middleware/request-id.middleware';

/**
 * Apply the full HTTP hardening pipeline to a NestJS application instance.
 * Extracted from main.ts so it can be reused identically in integration tests,
 * guaranteeing that the test exercises the real production pipeline.
 *
 * The following are configured here:
 *  - helmet security headers
 *  - CORS with configured origins
 *  - Global API prefix (api/)
 *  - JSON body limit (256 kB)
 *  - Global ValidationPipe (whitelist, forbidNonWhitelisted, transform)
 *  - AllExceptionsFilter
 *  - Graceful shutdown hooks (Prisma disconnects on SIGTERM)
 *
 * ThrottlerGuard and AuthGuard/RolesGuard are applied globally via APP_GUARD in AppModule.
 */
export function configureApp(app: INestApplication, envConfig: ValidatedEnvironment): void {
  // Trust proxy configuration. Defaults to false (unset -> false).
  // Only trusts proxies when configured with a hop count or IP/CIDR string.
  const httpAdapter = app.getHttpAdapter();
  if (httpAdapter && typeof httpAdapter.getInstance === 'function') {
    const expressApp = httpAdapter.getInstance();
    if (expressApp && typeof expressApp.set === 'function') {
      expressApp.set('trust proxy', envConfig.TRUST_PROXY);
    }
  }

  // Request ID middleware so every incoming request and log line has req.id and x-request-id
  app.use(requestIdHandler);

  // Security headers (X-Content-Type-Options, X-Frame-Options, HSTS, CSP, etc.)
  app.use(helmet());

  // CORS
  app.enableCors({
    origin: envConfig.CORS_ORIGIN,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api');

  // JSON body size limit (256 kB) — protects against payload-flooding attacks
  app.use(json({ limit: '256kb' }));
  app.use(urlencoded({ extended: true, limit: '256kb' }));

  // Input validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Exception / error normalisation filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Graceful shutdown — lets Prisma disconnect and in-flight requests drain on SIGTERM
  app.enableShutdownHooks();
}
