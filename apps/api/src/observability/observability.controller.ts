import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { ObservabilityService } from './observability.service';

/**
 * Controller for retrieving in-memory distributed traces and telemetry status.
 *
 * NOTE: For this local developer POC environment, endpoints are open to facilitate
 * debugging, local trace waterfall inspection, and demo resets.
 * In a multi-tenant production environment, these endpoints MUST be guarded by
 * administrative role-based access control (e.g. @Roles('admin') / @UseGuards(AdminAuthGuard))
 * to prevent unauthorized cross-tenant trace inspection or ring-buffer clearing.
 */
@Controller('observability')
export class ObservabilityController {
  constructor(private readonly observabilityService: ObservabilityService) {}

  @Get('traces')
  getTraces(
    @Query('status') status?: string,
    @Query('model') model?: string,
    @Query('operation') operation?: string,
    @Query('limit') limit?: string,
  ) {
    const numLimit = limit ? parseInt(limit, 10) : 50;
    return this.observabilityService.getTraces({
      status,
      model,
      operation,
      limit: numLimit,
    });
  }

  @Get('traces/:traceId')
  getTrace(@Param('traceId') traceId: string) {
    const trace = this.observabilityService.getTrace(traceId);
    if (!trace) {
      throw new NotFoundException(`Trace with ID "${traceId}" was not found.`);
    }
    return trace;
  }

  @Get('status')
  getStatus() {
    return this.observabilityService.getStatus();
  }

  @Post('clear')
  clearTraces() {
    this.observabilityService.clearTraces();
    return { success: true, message: 'In-memory trace buffer cleared.' };
  }
}
