import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { CreatePromptDto } from './dto/create-prompt.dto';
import { CreateVersionDto } from './dto/create-version.dto';
import { PreviewPromptDto, RunPlaygroundDto } from './dto/run-prompt.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { ThrottleUser } from '../common/guards/user-throttler.guard';

@Controller('prompts')
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() pagination: PaginationQueryDto,
    @Query('search') search?: string,
    @Query('technique') technique?: string,
  ) {
    return this.promptsService.findAll(userId, {
      search,
      technique,
      limit: pagination.limit,
      offset: pagination.offset,
    });
  }

  @Get(':id')
  async findById(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.promptsService.findById(id, userId);
  }

  @Post()
  async create(
    @Body() dto: CreatePromptDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.promptsService.create(dto, userId);
  }

  @Post(':id/versions')
  async createVersion(
    @Param('id') id: string,
    @Body() dto: CreateVersionDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.promptsService.createVersion(id, dto, userId);
  }

  @Post('preview')
  preview(@Body() dto: PreviewPromptDto) {
    return this.promptsService.resolveTemplate(dto);
  }

  @Post('run')
  @ThrottleUser()
  async runPlayground(
    @Body() dto: RunPlaygroundDto,
    @CurrentUser('id') userId: string,
    @IdempotencyKey() idempotencyKey?: string,
  ) {
    return this.promptsService.runPlayground(dto, userId, idempotencyKey);
  }
}

