import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Query,
} from '@nestjs/common';
import { UsageService } from './usage.service';
import { UpdateQuotaPolicyDto } from './dto/usage.dto';

@Controller('usage')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get('status')
  async getStatus() {
    return this.usageService.getStatus();
  }

  @Get('ledger')
  async getLedger(@Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : 50;
    const numLimit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 50;
    return this.usageService.getUsageLedger(undefined, numLimit);
  }

  @Get('policy')
  async getPolicy() {
    return this.usageService.getPolicy();
  }

  @Put('policy')
  async updatePolicy(@Body() dto: UpdateQuotaPolicyDto) {
    return this.usageService.updatePolicy(dto);
  }

  @Post('reset')
  async resetPeriod() {
    return this.usageService.resetPeriodForDemo();
  }
}
