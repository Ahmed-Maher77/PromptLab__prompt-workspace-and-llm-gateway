import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { validateEnvironment } from './common/config/env.validation';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Validate critical environment configuration early
  let envConfig;
  try {
    envConfig = validateEnvironment();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(msg);
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: envConfig.CORS_ORIGIN,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = envConfig.PORT;
  await app.listen(port);
  logger.log(`PromptLab API server successfully started on port ${port} (prefix: /api)`);
  logger.log(`Health endpoint: http://localhost:${port}/api/health`);
  logger.log(`CORS allowed origin(s): ${JSON.stringify(envConfig.CORS_ORIGIN)}`);
}

bootstrap();
