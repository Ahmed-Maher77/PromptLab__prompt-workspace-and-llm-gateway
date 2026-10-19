import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';

import { ProvidersModule } from './providers/providers.module';
import { PromptsModule } from './prompts/prompts.module';
import { ExperimentsModule } from './experiments/experiments.module';
import { ConversationsModule } from './conversations/conversations.module';
import { UsageModule } from './usage/usage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    HealthModule,
    ProvidersModule,
    PromptsModule,
    ExperimentsModule,
    ConversationsModule,
    UsageModule,
  ],
})
export class AppModule {}
