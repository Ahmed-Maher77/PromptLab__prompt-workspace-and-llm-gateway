import {
  Injectable,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  SetMetadata,
  CustomDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerStorage,
  getOptionsToken,
  ThrottlerModuleOptions,
  ThrottlerRequest,
  ThrottlerLimitDetail,
} from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';

export const LLM_USER_THROTTLE_KEY = 'LLM_USER_THROTTLE';

/**
 * Decorator to apply per-user rate limiting to LLM-executing routes.
 */
export const ThrottleUser = (): CustomDecorator<string> =>
  SetMetadata(LLM_USER_THROTTLE_KEY, true);

/**
 * Per-user rate limiter backed by @nestjs/throttler.
 * Keyed by authenticated user ID via custom getTracker.
 * Applies only to LLM-executing endpoints marked with @ThrottleUser().
 * Idempotent replays (requests with an Idempotency-Key matching an existing reconciled record)
 * are checked before counting and skip counter increment.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(ThrottlerStorage) storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    super(options, storageService, reflector);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isLlmThrottled = this.reflector.getAllAndOverride<boolean>(
      LLM_USER_THROTTLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!isLlmThrottled) {
      return true;
    }
    if (!this.throttlers) {
      await this.onModuleInit();
    }
    return super.canActivate(context);
  }

  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    if (requestProps.throttler.name !== 'user') {
      return true;
    }

    const { context } = requestProps;
    const req = context.switchToHttp().getRequest();
    const userId = req.user?.id;
    if (!userId) {
      return true;
    }

    // Idempotency check before counting:
    // If request has Idempotency-Key and a reconciled record already exists,
    // skip counting for this replay so it does not consume an extra rate-limit unit.
    const rawKey = req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'];
    if (rawKey) {
      const key = Array.isArray(rawKey) ? rawKey[0] : String(rawKey);
      const existing = await this.prisma.usageRecord.findFirst({
        where: {
          userId,
          requestId: { in: [key, `${key}:A`, `${key}:B`] },
          status: 'reconciled',
        },
        select: { id: true },
      });
      if (existing) {
        return true;
      }
    }

    // Dynamic limit lookup from QuotaPolicy if exists
    let limit = requestProps.limit;
    try {
      const policy = await this.prisma.quotaPolicy.findUnique({
        where: { scope_scopeId: { scope: 'user', scopeId: userId } },
        select: { requestRateLimit: true },
      });
      if (policy?.requestRateLimit) {
        limit = policy.requestRateLimit;
      }
    } catch {
      // fallback to default configured limit
    }

    return super.handleRequest({
      ...requestProps,
      limit,
    });
  }

  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const user = req.user as AuthenticatedUser | undefined;
    return user?.id ? `user:${user.id}` : (req.ips?.length ? req.ips[0] : req.ip);
  }

  protected override generateKey(_context: ExecutionContext, tracker: string, name: string): string {
    return `${name}-${tracker}`;
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'RATE_LIMIT_EXCEEDED',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Request rate limit exceeded. Please wait before retrying.',
        retryAfterSeconds: throttlerLimitDetail.timeToBlockExpire,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
