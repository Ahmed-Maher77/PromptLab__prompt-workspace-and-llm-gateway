import { Module } from '@nestjs/common';
import { ProvidersService } from './providers.service';
import { ProvidersController } from './providers.controller';
import { ModelCatalogService } from './model-catalog.service';

import { TokensModule } from '../tokens/tokens.module';

@Module({
  imports: [TokensModule],
  controllers: [ProvidersController],
  providers: [ProvidersService, ModelCatalogService],
  exports: [ProvidersService, ModelCatalogService],
})
export class ProvidersModule {}
