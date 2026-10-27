import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { TokenCounterService } from './token-counter.service';
import { EstimateTokensDto } from './dto/estimate-tokens.dto';
import { TokenCountResult } from './tokens.types';

@Controller('tokens')
export class TokensController {
  constructor(private readonly tokenCounterService: TokenCounterService) {}

  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  estimate(@Body() dto: EstimateTokensDto): TokenCountResult {
    if (dto.messages && dto.messages.length > 0) {
      return this.tokenCounterService.countMessages(
        dto.messages,
        dto.model,
        dto.provider,
      );
    }
    return this.tokenCounterService.countText(
      dto.text ?? '',
      dto.model,
      dto.provider,
    );
  }
}
