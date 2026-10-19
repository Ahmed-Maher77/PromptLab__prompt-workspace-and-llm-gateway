import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Successfully connected to PostgreSQL via Prisma');
    } catch (error) {
      this.logger.warn(`Could not eagerly connect to database on startup: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Disconnected from database');
  }

  async checkHealth(): Promise<{ status: 'connected' | 'disconnected'; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.$queryRaw`SELECT 1`;
      return {
        status: 'connected',
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      this.logger.error(`Database health check failed: ${(error as Error).message}`);
      return {
        status: 'disconnected',
        latencyMs: Date.now() - start,
        error: 'Database connection or query failed',
      };
    }
  }
}
