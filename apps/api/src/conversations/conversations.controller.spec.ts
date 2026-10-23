import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ApplyCompactionDto } from './dto/compact-conversation.dto';

describe('ConversationsController', () => {
  let controller: ConversationsController;
  let mockService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockService = {
      create: jest.fn().mockResolvedValue({ id: 'c-1', title: 'Test Conv' }),
      findAll: jest.fn().mockResolvedValue([{ id: 'c-1', title: 'Test Conv' }]),
      findOne: jest.fn().mockResolvedValue({ id: 'c-1', title: 'Test Conv', messages: [] }),
      delete: jest.fn().mockResolvedValue({ success: true }),
      inspectContext: jest.fn().mockResolvedValue({ withinBudget: true, assembledMessages: [] }),
      sendMessage: jest.fn().mockResolvedValue({ success: true, assistantMessage: { content: 'Hi' } }),
      previewCompaction: jest.fn().mockResolvedValue({ tokenSavings: 100 }),
      applyCompaction: jest.fn().mockResolvedValue({ success: true }),
      resume: jest.fn().mockResolvedValue({ success: true, activeCheckpoint: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        {
          provide: ConversationsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ConversationsController>(ConversationsController);
  });

  it('delegates create to conversationsService', async () => {
    const dto: CreateConversationDto = {
      title: 'New Conversation',
      model: 'gpt-4o-mini',
      provider: 'openai',
    };
    const result = await controller.create(dto);
    expect(mockService.create).toHaveBeenCalledWith(dto);
    expect(result).toMatchObject({ id: 'c-1', title: 'Test Conv' });
  });

  it('delegates findAll with pagination query', async () => {
    const pagination = { limit: 10, offset: 0 };
    await controller.findAll(pagination);
    expect(mockService.findAll).toHaveBeenCalledWith(undefined, pagination);
  });

  it('delegates findOne, inspectContext, and delete by ID', async () => {
    await controller.findOne('c-1');
    expect(mockService.findOne).toHaveBeenCalledWith('c-1');

    await controller.inspectContext('c-1', 'what is next?');
    expect(mockService.inspectContext).toHaveBeenCalledWith('c-1', 'what is next?');

    await controller.delete('c-1');
    expect(mockService.delete).toHaveBeenCalledWith('c-1');
  });

  it('delegates sendMessage to service', async () => {
    const dto: SendMessageDto = { content: 'Hello assistant' };
    await controller.sendMessage('c-1', dto);
    expect(mockService.sendMessage).toHaveBeenCalledWith('c-1', dto);
  });

  it('delegates previewCompaction, applyCompaction, and resume', async () => {
    await controller.previewCompaction('c-1');
    expect(mockService.previewCompaction).toHaveBeenCalledWith('c-1', undefined);

    const applyDto: ApplyCompactionDto = {
      summary: 'Summary',
      retainedFacts: ['Fact 1'],
      compactedThroughSequence: 3,
    };
    await controller.applyCompaction('c-1', applyDto);
    expect(mockService.applyCompaction).toHaveBeenCalledWith('c-1', applyDto);

    await controller.resume('c-1', 'chk-1');
    expect(mockService.resume).toHaveBeenCalledWith('c-1', 'chk-1');
  });
});
