import { Module } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { PromptsController } from './prompts.controller';
import { ProvidersModule } from '../providers/providers.module';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [ProvidersModule, UsageModule],
  controllers: [PromptsController],
  providers: [PromptsService],
  exports: [PromptsService],
})
export class PromptsModule {}
