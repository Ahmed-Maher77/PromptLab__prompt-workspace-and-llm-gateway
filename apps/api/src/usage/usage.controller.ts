import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { UsageService } from './usage.service';
import { UpdateQuotaPolicyDto } from './dto/usage.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('usage')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get('status')
  async getStatus(@CurrentUser('id') userId: string) {
    return this.usageService.getStatus(userId);
  }

  @Get('ledger')
  async getLedger(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit ? parseInt(limit, 10) : 50;
    const numLimit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 50;
    return this.usageService.getUsageLedger(userId, numLimit);
  }

  @Get('policy')
  async getPolicy(@CurrentUser('id') userId: string) {
    return this.usageService.getPolicy(userId);
  }

  @Put('policy')
  @Roles('admin')
  async updatePolicy(@Body() dto: UpdateQuotaPolicyDto) {
    return this.usageService.updatePolicy(dto);
  }

  @Post('reset')
  @Roles('admin')
  async resetPeriod() {
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_DEMO_ENDPOINTS !== 'true') {
      throw new ForbiddenException('Demo endpoints are disabled in this environment.');
    }
    return this.usageService.resetPeriodForDemo();
  }
}

