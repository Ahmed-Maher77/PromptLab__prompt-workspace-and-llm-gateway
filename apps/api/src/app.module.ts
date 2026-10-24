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
import { SettingsModule } from './settings/settings.module';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from './common/guards/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    JwtModule.register({
      global: true,
    }),
    // SEC-04: per-IP rate limiting — 60 requests per 60 s window, burst cap of 20/s
    ThrottlerModule.forRoot([{
      name: 'default',
      ttl: 60_000,
      limit: 60,
    }]),
    PrismaModule,
    HealthModule,
    ProvidersModule,
    PromptsModule,
    ExperimentsModule,
    ConversationsModule,
    UsageModule,
    ObservabilityModule,
    SettingsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      // SEC-04: global rate limiting via ThrottlerGuard
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
