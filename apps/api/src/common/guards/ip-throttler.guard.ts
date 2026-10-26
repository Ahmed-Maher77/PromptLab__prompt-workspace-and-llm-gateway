import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';

/**
 * Global IP-based throttler guard.
 * Enforces per-IP limits ('default' and 'burst') before authentication.
 * Skips the named 'user' throttler, which is evaluated after AuthGuard by UserThrottlerGuard.
 */
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  override async canActivate(context: any): Promise<boolean> {
    if (!this.throttlers) {
      await this.onModuleInit();
    }
    return super.canActivate(context);
  }

  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    if (requestProps.throttler.name === 'user') {
      return true;
    }
    return super.handleRequest(requestProps);
  }
}
