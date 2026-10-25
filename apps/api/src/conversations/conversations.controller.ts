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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  async create(
    @Body() dto: CreateConversationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.conversationsService.create(dto, userId);
  }

  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.conversationsService.findAll(userId, pagination);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.conversationsService.findOne(id, userId);
  }

  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.conversationsService.delete(id, userId);
  }

  @Get(':id/context')
  async inspectContext(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Query('proposedInput') proposedInput?: string,
  ) {
    return this.conversationsService.inspectContext(id, proposedInput, userId);
  }

  @Post(':id/messages')
  async sendMessage(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SendMessageDto,
    @IdempotencyKey() idempotencyKey?: string,
  ) {
    return this.conversationsService.sendMessage(id, dto, userId, idempotencyKey);
  }

  @Post(':id/compact/preview')
  async previewCompaction(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto?: PreviewCompactionDto,
    @IdempotencyKey() idempotencyKey?: string,
  ) {
    return this.conversationsService.previewCompaction(id, dto, userId, idempotencyKey);
  }

  @Post(':id/compact/apply')
  async applyCompaction(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ApplyCompactionDto,
  ) {
    return this.conversationsService.applyCompaction(id, dto, userId);
  }

  @Post(':id/resume')
  async resume(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Query('checkpointId') checkpointId?: string,
  ) {
    return this.conversationsService.resume(id, checkpointId, userId);
  }
}

