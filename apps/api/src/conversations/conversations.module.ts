import { Module } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ProvidersModule } from '../providers/providers.module';
import { UsageModule } from '../usage/usage.module';
import { ObservabilityModule } from '../observability/observability.module';

import { LlmModule } from '../llm/llm.module';
import { TokensModule } from '../tokens/tokens.module';

@Module({
  imports: [PrismaModule, ProvidersModule, UsageModule, ObservabilityModule, LlmModule, TokensModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
