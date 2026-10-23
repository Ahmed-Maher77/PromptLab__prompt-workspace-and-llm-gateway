import { Test, TestingModule } from '@nestjs/testing';
import { ExperimentsController } from './experiments.controller';
import { ExperimentsService } from './experiments.service';
import { RunComparisonDto, RateExperimentDto } from './dto/run-comparison.dto';

describe('ExperimentsController', () => {
  let controller: ExperimentsController;
  let mockService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockService = {
      findAll: jest.fn().mockResolvedValue([{ id: 'exp-1', name: 'Test Comparison' }]),
      findById: jest.fn().mockResolvedValue({ id: 'exp-1', name: 'Test Comparison' }),
      runComparison: jest.fn().mockResolvedValue({ id: 'exp-1', results: [] }),
      updateRating: jest.fn().mockResolvedValue({ id: 'exp-1', slot: 'A', rating: 5 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExperimentsController],
      providers: [
        {
          provide: ExperimentsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ExperimentsController>(ExperimentsController);
  });

  it('delegates findAll with pagination query', async () => {
    const pagination = { limit: 5, offset: 0 };
    const res = await controller.findAll(pagination);
    expect(mockService.findAll).toHaveBeenCalledWith('dev-user-001', pagination);
    expect(res).toEqual([{ id: 'exp-1', name: 'Test Comparison' }]);
  });

  it('delegates findById to service', async () => {
    const res = await controller.findById('exp-1');
    expect(mockService.findById).toHaveBeenCalledWith('exp-1');
    expect(res.id).toBe('exp-1');
  });

  it('delegates runComparison to service', async () => {
    const dto: RunComparisonDto = {
      name: 'Comparison Test',
      commonInput: { query: 'summarize' },
      slotA: { provider: 'openai', model: 'gpt-4o-mini' },
      slotB: { provider: 'anthropic', model: 'claude-3-5-sonnet' },
    };
    await controller.runComparison(dto);
    expect(mockService.runComparison).toHaveBeenCalledWith(dto);
  });

  it('delegates updateRating to service', async () => {
    const dto: RateExperimentDto = {
      slot: 'A',
      rating: 5,
      notes: 'Candidate A was faster and more concise',
    };
    await controller.updateRating('exp-1', dto);
    expect(mockService.updateRating).toHaveBeenCalledWith('exp-1', dto);
  });
});
