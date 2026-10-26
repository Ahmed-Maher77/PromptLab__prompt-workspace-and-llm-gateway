import * as path from 'path';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';

import { ProvidersModule } from './providers/providers.module';
import { PromptsModule } from './prompts/prompts.module';
import { ExperimentsModule } from './experiments/experiments.module';
import { ConversationsModule } from './conversations/conversations.module';
import { UsageModule } from './usage/usage.module';
import { ObservabilityModule } from './observability/observability.module';
import { LlmModule } from './llm/llm.module';
import { SettingsModule } from './settings/settings.module';
import { TokensModule } from './tokens/tokens.module';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';
import { AuthConfigModule } from './common/config/auth-config.module';
import { validateEnvironment } from './common/config/env.validation';
import { IpThrottlerGuard } from './common/guards/ip-throttler.guard';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import { AuthGuard } from './common/guards/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
      envFilePath: [
        path.resolve(process.cwd(), '.env'),
        path.resolve(__dirname, '../../.env'),
        path.resolve(__dirname, '../../../.env'),
        path.resolve(__dirname, '../.env'),
      ],
    }),
    ScheduleModule.forRoot(),
    JwtModule.register({
      global: true,
    }),
    AuthConfigModule,
    // Per-IP rate limiting (default 60/min, burst 20/s) and named per-user rate limiting (user 60/min)
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 60,
      },
      {
        name: 'burst',
        ttl: 1000,
        limit: 20,
      },
      {
        name: 'user',
        ttl: 60_000,
        limit: 60,
      },
    ]),
    PrismaModule,
    HealthModule,
    ProvidersModule,
    PromptsModule,
    ExperimentsModule,
    ConversationsModule,
    UsageModule,
    ObservabilityModule,
    LlmModule,
    SettingsModule,
    TokensModule,
  ],
  providers: [
    {
      // Global per-IP rate limiting via IpThrottlerGuard registered BEFORE AuthGuard
      provide: APP_GUARD,
      useClass: IpThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      // Per-user rate limiting applied to LLM-executing routes registered AFTER AuthGuard
      provide: APP_GUARD,
      useClass: UserThrottlerGuard,
    },
  ],
})
export class AppModule {}
