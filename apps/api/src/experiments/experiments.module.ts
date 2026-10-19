import { Module } from '@nestjs/common';
import { ExperimentsService } from './experiments.service';
import { ExperimentsController } from './experiments.controller';
import { ProvidersModule } from '../providers/providers.module';
import { PromptsModule } from '../prompts/prompts.module';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [ProvidersModule, PromptsModule, UsageModule],
  controllers: [ExperimentsController],
  providers: [ExperimentsService],
  exports: [ExperimentsService],
})
export class ExperimentsModule {}
