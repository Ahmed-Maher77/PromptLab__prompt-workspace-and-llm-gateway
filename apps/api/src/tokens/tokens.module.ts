import { Module } from '@nestjs/common';
import { TokenCounterService } from './token-counter.service';
import { TokensController } from './tokens.controller';

@Module({
  controllers: [TokensController],
  providers: [TokenCounterService],
  exports: [TokenCounterService],
})
export class TokensModule {}
