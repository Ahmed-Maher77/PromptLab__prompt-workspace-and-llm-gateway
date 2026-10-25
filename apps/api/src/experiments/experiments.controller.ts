import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ExperimentsService } from './experiments.service';
import { RunComparisonDto, RateExperimentDto } from './dto/run-comparison.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';

@Controller('experiments')
export class ExperimentsController {
  constructor(private readonly experimentsService: ExperimentsService) {}

  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.experimentsService.findAll(userId, pagination);
  }

  @Get(':id')
  async findById(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.experimentsService.findById(id, userId);
  }

  @Post('run')
  async runComparison(
    @Body() dto: RunComparisonDto,
    @CurrentUser('id') userId: string,
    @IdempotencyKey() idempotencyKey?: string,
  ) {
    return this.experimentsService.runComparison(dto, userId, idempotencyKey);
  }

  @Post(':id/rate')
  async updateRating(
    @Param('id') id: string,
    @Body() dto: RateExperimentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.experimentsService.updateRating(id, dto, userId);
  }
}

