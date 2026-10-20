import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import {
  PreviewCompactionDto,
  ApplyCompactionDto,
} from './dto/compact-conversation.dto';

import { PaginationQueryDto } from '../common/dto/pagination.dto';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  async create(@Body() dto: CreateConversationDto) {
    return this.conversationsService.create(dto);
  }

  @Get()
  async findAll(@Query() pagination: PaginationQueryDto) {
    return this.conversationsService.findAll(undefined, pagination);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.conversationsService.findOne(id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.conversationsService.delete(id);
  }

  @Get(':id/context')
  async inspectContext(
    @Param('id') id: string,
    @Query('proposedInput') proposedInput?: string,
  ) {
    return this.conversationsService.inspectContext(id, proposedInput);
  }

  @Post(':id/messages')
  async sendMessage(@Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.conversationsService.sendMessage(id, dto);
  }

  @Post(':id/compact/preview')
  async previewCompaction(
    @Param('id') id: string,
    @Body() dto?: PreviewCompactionDto,
  ) {
    return this.conversationsService.previewCompaction(id, dto);
  }

  @Post(':id/compact/apply')
  async applyCompaction(
    @Param('id') id: string,
    @Body() dto: ApplyCompactionDto,
  ) {
    return this.conversationsService.applyCompaction(id, dto);
  }

  @Post(':id/resume')
  async resume(
    @Param('id') id: string,
    @Query('checkpointId') checkpointId?: string,
  ) {
    return this.conversationsService.resume(id, checkpointId);
  }
}
