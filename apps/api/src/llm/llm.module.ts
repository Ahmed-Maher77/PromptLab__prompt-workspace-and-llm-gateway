import { Module } from '@nestjs/common';
import { LlmExecutionService } from './llm-execution.service';
import { ProvidersModule } from '../providers/providers.module';
import { UsageModule } from '../usage/usage.module';
import { ObservabilityModule } from '../observability/observability.module';
import { TokensModule } from '../tokens/tokens.module';

@Module({
  imports: [ProvidersModule, UsageModule, ObservabilityModule, TokensModule],
  providers: [LlmExecutionService],
  exports: [LlmExecutionService],
})
export class LlmModule {}
