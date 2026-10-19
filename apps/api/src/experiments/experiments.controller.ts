import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ExperimentsService } from './experiments.service';
import { RunComparisonDto, RateExperimentDto } from './dto/run-comparison.dto';

@Controller('experiments')
export class ExperimentsController {
  constructor(private readonly experimentsService: ExperimentsService) {}

  @Get()
  async findAll() {
    return this.experimentsService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.experimentsService.findById(id);
  }

  @Post('run')
  async runComparison(@Body() dto: RunComparisonDto) {
    return this.experimentsService.runComparison(dto);
  }

  @Post(':id/rate')
  async updateRating(
    @Param('id') id: string,
    @Body() dto: RateExperimentDto,
  ) {
    return this.experimentsService.updateRating(id, dto);
  }
}
