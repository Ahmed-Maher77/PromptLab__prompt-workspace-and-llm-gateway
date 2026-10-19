import { Module } from '@nestjs/common';
import { ExperimentsService } from './experiments.service';
import { ExperimentsController } from './experiments.controller';
import { ProvidersModule } from '../providers/providers.module';
import { PromptsModule } from '../prompts/prompts.module';

@Module({
  imports: [ProvidersModule, PromptsModule],
  controllers: [ExperimentsController],
  providers: [ExperimentsService],
  exports: [ExperimentsService],
})
export class ExperimentsModule {}
