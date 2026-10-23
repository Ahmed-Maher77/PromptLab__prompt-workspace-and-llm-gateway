import { Test, TestingModule } from '@nestjs/testing';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';

describe('ProvidersController', () => {
  let controller: ProvidersController;
  let mockService: { listModels: jest.Mock };

  beforeEach(async () => {
    mockService = {
      listModels: jest.fn().mockResolvedValue({
        gatewayConnected: true,
        models: [{ id: 'gpt-4o-mini', provider: 'openai', name: 'GPT-4o Mini' }],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProvidersController],
      providers: [
        {
          provide: ProvidersService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ProvidersController>(ProvidersController);
  });

  it('delegates getModels to providersService.listModels', async () => {
    const result = await controller.getModels();
    expect(mockService.listModels).toHaveBeenCalled();
    expect(result.gatewayConnected).toBe(true);
    expect(result.models.length).toBe(1);
  });
});
