import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { CreatePromptDto } from './dto/create-prompt.dto';
import { CreateVersionDto } from './dto/create-version.dto';
import { PreviewPromptDto, RunPlaygroundDto } from './dto/run-prompt.dto';

@Controller('prompts')
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('technique') technique?: string,
  ) {
    return this.promptsService.findAll({ search, technique });
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.promptsService.findById(id);
  }

  @Post()
  async create(@Body() dto: CreatePromptDto) {
    return this.promptsService.create(dto);
  }

  @Post(':id/versions')
  async createVersion(
    @Param('id') id: string,
    @Body() dto: CreateVersionDto,
  ) {
    return this.promptsService.createVersion(id, dto);
  }

  @Post('preview')
  preview(@Body() dto: PreviewPromptDto) {
    return this.promptsService.resolveTemplate(dto);
  }

  @Post('run')
  async runPlayground(@Body() dto: RunPlaygroundDto) {
    return this.promptsService.runPlayground(dto);
  }
}
