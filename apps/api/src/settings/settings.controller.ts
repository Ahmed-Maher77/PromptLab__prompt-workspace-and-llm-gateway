import { Controller, Get } from '@nestjs/common';
import { SettingsService, SystemSettingsResponse } from './settings.service';

/**
 * Controller for retrieving safe, read-only system settings and runtime environment status.
 * Never exposes secrets, API keys, or database credentials.
 */
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getSettings(): Promise<SystemSettingsResponse> {
    return this.settingsService.getSettings();
  }
}
