import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsageService } from './usage.service';
import { UsageController } from './usage.controller';

@Module({
  imports: [PrismaModule],
  controllers: [UsageController],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
