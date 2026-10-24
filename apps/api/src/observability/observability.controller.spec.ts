import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ObservabilityController } from './observability.controller';
import { ObservabilityService } from './observability.service';

describe('ObservabilityController', () => {
  let controller: ObservabilityController;
  let mockService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockService = {
      getTraces: jest.fn().mockReturnValue([
        { id: 'trace-1', operation: 'run_prompt', status: 'success' },
      ]),
      getTrace: jest.fn().mockImplementation((id: string) => {
        if (id === 'trace-1') {
          return { id: 'trace-1', operation: 'run_prompt', status: 'success' };
        }
        return null;
      }),
      getStatus: jest.fn().mockReturnValue({
        telemetryEnabled: true,
        totalTracesRecorded: 10,
      }),
      clearTraces: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ObservabilityController],
      providers: [
        {
          provide: ObservabilityService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ObservabilityController>(ObservabilityController);
  });

  it('delegates getTraces with parsed filter params and limit', () => {
    const traces = controller.getTraces('success', 'gpt-4o-mini', 'playground', '25');
    expect(mockService.getTraces).toHaveBeenCalledWith({
      status: 'success',
      model: 'gpt-4o-mini',
      operation: 'playground',
      limit: 25,
    });
    expect(traces.length).toBe(1);
  });

  it('delegates getTrace by id when found', () => {
    const trace = controller.getTrace('trace-1');
    expect(mockService.getTrace).toHaveBeenCalledWith('trace-1');
    expect(trace.id).toBe('trace-1');
  });

  it('throws NotFoundException when trace is not found', () => {
    expect(() => controller.getTrace('non-existent')).toThrow(NotFoundException);
  });

  it('delegates getStatus and clearTraces', () => {
    process.env.ENABLE_DEMO_ENDPOINTS = 'true';
    process.env.NODE_ENV = 'development';
    const status = controller.getStatus();
    expect(status.telemetryEnabled).toBe(true);

    const clearRes = controller.clearTraces();
    expect(mockService.clearTraces).toHaveBeenCalled();
    expect(clearRes.success).toBe(true);
  });

});
