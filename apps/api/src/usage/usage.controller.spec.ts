import { Test, TestingModule } from '@nestjs/testing';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';
import { UpdateQuotaPolicyDto } from './dto/usage.dto';

describe('UsageController', () => {
  let controller: UsageController;
  let mockService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockService = {
      getStatus: jest.fn().mockResolvedValue({
        tokenLimit: 100000,
        actualTokens: 12500,
        remainingTokens: 87500,
      }),
      getUsageLedger: jest.fn().mockResolvedValue([
        { id: 'ledger-1', actualTokens: 150, operation: 'playground' },
      ]),
      getPolicy: jest.fn().mockResolvedValue({
        monthlyTokenLimit: 100000,
        requestRateLimit: 60,
      }),
      updatePolicy: jest.fn().mockResolvedValue({
        monthlyTokenLimit: 200000,
        requestRateLimit: 120,
      }),
      resetPeriodForDemo: jest.fn().mockResolvedValue({ success: true, message: 'Reset' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsageController],
      providers: [
        {
          provide: UsageService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<UsageController>(UsageController);
  });

  it('delegates getStatus to service', async () => {
    const status = await controller.getStatus('dev-user-001');
    expect(mockService.getStatus).toHaveBeenCalledWith('dev-user-001');
    expect(status.tokenLimit).toBe(100000);
  });

  it('delegates getLedger with bounded limit parameter', async () => {
    await controller.getLedger('dev-user-001', '25');
    expect(mockService.getUsageLedger).toHaveBeenCalledWith('dev-user-001', 25);

    // Limit cap at 100
    await controller.getLedger('dev-user-001', '500');
    expect(mockService.getUsageLedger).toHaveBeenCalledWith('dev-user-001', 100);

    // Invalid fallback to 50
    await controller.getLedger('dev-user-001', 'invalid');
    expect(mockService.getUsageLedger).toHaveBeenCalledWith('dev-user-001', 50);
  });

  it('delegates getPolicy and updatePolicy to service', async () => {
    const policy = await controller.getPolicy('dev-user-001');
    expect(mockService.getPolicy).toHaveBeenCalledWith('dev-user-001');
    expect(policy.monthlyTokenLimit).toBe(100000);


    const dto: UpdateQuotaPolicyDto = {
      monthlyTokenLimit: 200000,
      requestRateLimit: 120,
    };
    const updated = await controller.updatePolicy('dev-user-001', dto);
    expect(mockService.updatePolicy).toHaveBeenCalledWith(dto, 'dev-user-001');
    expect(updated.monthlyTokenLimit).toBe(200000);
  });

  it('delegates resetPeriod to service', async () => {
    process.env.ENABLE_DEMO_ENDPOINTS = 'true';
    process.env.NODE_ENV = 'development';
    const res = await controller.resetPeriod('dev-user-001');
    expect(mockService.resetPeriodForDemo).toHaveBeenCalledWith('dev-user-001');
    expect(res.success).toBe(true);
  });

});
