import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { validateEnvironment } from './common/config/env.validation';
import { configureApp } from './configure-app';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Validate critical environment configuration early — fails loudly on misconfiguration
  let envConfig;
  try {
    envConfig = validateEnvironment();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(msg);
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);

  // SEC-04: apply full HTTP hardening pipeline (helmet, CORS, body limit, pipes, etc.)
  configureApp(app, envConfig);

  const port = envConfig.PORT;
  await app.listen(port);
  logger.log(`PromptLab API server successfully started on port ${port} (prefix: /api)`);
  logger.log(`Health endpoint: http://localhost:${port}/api/health`);
  logger.log(`CORS allowed origin(s): ${JSON.stringify(envConfig.CORS_ORIGIN)}`);
}

bootstrap();
