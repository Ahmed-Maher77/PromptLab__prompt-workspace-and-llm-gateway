import { Module } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ProvidersModule } from '../providers/providers.module';
import { UsageModule } from '../usage/usage.module';
import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [PrismaModule, ProvidersModule, UsageModule, ObservabilityModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
