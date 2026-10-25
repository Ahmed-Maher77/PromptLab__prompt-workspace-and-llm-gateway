import { Test, TestingModule } from '@nestjs/testing';
import { PromptsController } from './prompts.controller';
import { PromptsService } from './prompts.service';
import { CreatePromptDto } from './dto/create-prompt.dto';
import { CreateVersionDto } from './dto/create-version.dto';
import { PreviewPromptDto, RunPlaygroundDto } from './dto/run-prompt.dto';

describe('PromptsController', () => {
  let controller: PromptsController;
  let mockService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockService = {
      findAll: jest.fn().mockResolvedValue([{ id: 'p-1', name: 'Test Prompt' }]),
      findById: jest.fn().mockResolvedValue({ id: 'p-1', name: 'Test Prompt', versions: [] }),
      create: jest.fn().mockResolvedValue({ id: 'p-1', name: 'Test Prompt' }),
      createVersion: jest.fn().mockResolvedValue({ id: 'v-2', versionNumber: 2 }),
      resolveTemplate: jest.fn().mockReturnValue({ resolvedPrompt: 'Hello Alice', missingVariables: [] }),
      runPlayground: jest.fn().mockResolvedValue({ output: 'Generated response', estimatedInputTokens: 5 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PromptsController],
      providers: [
        {
          provide: PromptsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<PromptsController>(PromptsController);
  });

  it('delegates findAll with search, technique and pagination', async () => {
    const pagination = { limit: 10, offset: 5 };
    const res = await controller.findAll('dev-user-001', pagination, 'classifier', 'few_shot');
    expect(mockService.findAll).toHaveBeenCalledWith('dev-user-001', {
      search: 'classifier',
      technique: 'few_shot',
      limit: 10,
      offset: 5,
    });
    expect(res.length).toBe(1);
  });

  it('delegates findById to service', async () => {
    const res = await controller.findById('p-1', 'dev-user-001');
    expect(mockService.findById).toHaveBeenCalledWith('p-1', 'dev-user-001');
    expect(res.id).toBe('p-1');
  });

  it('delegates create and createVersion to service', async () => {
    const createDto: CreatePromptDto = {
      name: 'Prompt',
      description: 'Desc',
      techniques: ['zero_shot'],
      templateBody: 'Do {{task}}',
      variables: [{ name: 'task', required: true }],
    };
    await controller.create(createDto, 'dev-user-001');
    expect(mockService.create).toHaveBeenCalledWith(createDto, 'dev-user-001');

    const versionDto: CreateVersionDto = {
      templateBody: 'Do {{task}} carefully',
      variables: [{ name: 'task', required: true }],
    };
    await controller.createVersion('p-1', versionDto, 'dev-user-001');
    expect(mockService.createVersion).toHaveBeenCalledWith('p-1', versionDto, 'dev-user-001');
  });

  it('delegates preview and runPlayground to service', async () => {
    const previewDto: PreviewPromptDto = {
      templateBody: 'Hello {{name}}',
      variables: { name: 'Alice' },
    };
    const previewRes = controller.preview(previewDto);
    expect(mockService.resolveTemplate).toHaveBeenCalledWith(previewDto);
    expect(previewRes.resolvedPrompt).toBe('Hello Alice');

    const runDto: RunPlaygroundDto = {
      promptId: 'p-1',
      versionNumber: 1,
      templateBody: 'Hello {{name}}',
      model: 'gpt-4o-mini',
    };
    await controller.runPlayground(runDto, 'dev-user-001', 'idemp-key-12345');
    expect(mockService.runPlayground).toHaveBeenCalledWith(runDto, 'dev-user-001', 'idemp-key-12345');
  });

});
