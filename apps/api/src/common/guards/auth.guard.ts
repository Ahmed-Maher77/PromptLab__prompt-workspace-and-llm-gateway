import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import {
  AUTH_CONFIG,
  ValidatedEnvironment,
} from '../config/env.validation';

/**
 * SEC-01a-2: Production-grade, secure-by-default authentication guard.
 *
 * Guarantees:
 *  - Single source of truth: reads pre-validated config via AUTH_CONFIG.
 *  - JwtService is mandatory (not optional).
 *  - Dev tokens only allowed when IS_DEV_OR_TEST is true AND AUTH_DEV_TOKENS_ENABLED is true.
 *  - No literal dev token fallbacks; tokens must be explicitly defined.
 *  - Timing-safe comparison using SHA-256 digests.
 *  - JWTs verified cryptographically with pinned HS256 algorithm.
 *  - JWTs require 'exp' claim and enforce maximum lifetime (exp - iat <= maxLifetime).
 *  - Checks issuer and audience when configured.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private devAdminDigest?: Buffer;
  private devUserDigest?: Buffer;

  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_CONFIG) private readonly authConfig: ValidatedEnvironment,
    private readonly jwtService: JwtService,
  ) {
    this.initDevDigests();
  }

  private initDevDigests(): void {
    if (
      this.authConfig.AUTH_DEV_TOKENS_ENABLED &&
      this.authConfig.IS_DEV_OR_TEST
    ) {
      if (this.authConfig.AUTH_DEV_ADMIN_TOKEN) {
        this.devAdminDigest = crypto
          .createHash('sha256')
          .update(this.authConfig.AUTH_DEV_ADMIN_TOKEN)
          .digest();
      }
      if (this.authConfig.AUTH_DEV_USER_TOKEN) {
        this.devUserDigest = crypto
          .createHash('sha256')
          .update(this.authConfig.AUTH_DEV_USER_TOKEN)
          .digest();
      }
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    const apiKeyHeader = request.headers['x-api-key'];

    let token: string | undefined;
    if (
      authHeader &&
      typeof authHeader === 'string' &&
      authHeader.startsWith('Bearer ')
    ) {
      token = authHeader.substring(7).trim();
    } else if (apiKeyHeader && typeof apiKeyHeader === 'string') {
      token = apiKeyHeader.trim();
    }

    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.resolveUserFromToken(token);
    if (!user) {
      throw new UnauthorizedException('Invalid authentication credentials');
    }

    request.user = user;
    return true;
  }

  private async resolveUserFromToken(
    token: string,
  ): Promise<AuthenticatedUser | null> {
    const candidateDigest = crypto.createHash('sha256').update(token).digest();

    // 1. Dev / test tokens: strictly allowed only when IS_DEV_OR_TEST is true AND AUTH_DEV_TOKENS_ENABLED is true
    if (
      this.authConfig.AUTH_DEV_TOKENS_ENABLED &&
      this.authConfig.IS_DEV_OR_TEST
    ) {
      if (
        this.devAdminDigest &&
        crypto.timingSafeEqual(candidateDigest, this.devAdminDigest)
      ) {
        return {
          id: 'dev-user-001',
          email: 'dev@promptlab.local',
          displayName: 'Developer Admin',
          role: 'admin',
        };
      }
      if (
        this.devUserDigest &&
        crypto.timingSafeEqual(candidateDigest, this.devUserDigest)
      ) {
        return {
          id: 'user-002',
          email: 'user2@promptlab.local',
          displayName: 'Test User',
          role: 'user',
        };
      }
    }

    // 2. Configured API keys (AUTH_API_KEYS) compared with timingSafeEqual on SHA-256 digests
    if (this.authConfig.AUTH_API_KEYS.length > 0) {
      for (const apiKey of this.authConfig.AUTH_API_KEYS) {
        if (crypto.timingSafeEqual(candidateDigest, apiKey.digest)) {
          return apiKey.user;
        }
      }
    }

    // 3. Cryptographically verified JWTs via @nestjs/jwt with pinned HS256 algorithm and claims validation
    if (
      this.authConfig.AUTH_JWT_SECRET &&
      this.authConfig.AUTH_JWT_SECRET.length >= 32
    ) {
      try {
        const verifyOptions: Record<string, unknown> = {
          secret: this.authConfig.AUTH_JWT_SECRET,
          algorithms: ['HS256'],
        };

        if (this.authConfig.AUTH_JWT_ISSUER) {
          verifyOptions.issuer = this.authConfig.AUTH_JWT_ISSUER;
        }
        if (this.authConfig.AUTH_JWT_AUDIENCE) {
          verifyOptions.audience = this.authConfig.AUTH_JWT_AUDIENCE;
        }

        const payload = await this.jwtService.verifyAsync<
          Record<string, unknown>
        >(token, verifyOptions);

        // SEC-01a-2: Require exp claim
        if (!payload || typeof payload.exp !== 'number') {
          return null;
        }

        const now = Math.floor(Date.now() / 1000);
        if (payload.exp <= now) {
          return null;
        }

        // SEC-01a-2: Enforce max token lifetime when iat is present
        if (typeof payload.iat === 'number') {
          const lifetime = payload.exp - payload.iat;
          if (
            lifetime > this.authConfig.AUTH_JWT_MAX_LIFETIME_SECONDS ||
            lifetime <= 0
          ) {
            return null;
          }
        }

        if (payload.sub || payload.id) {
          return {
            id: String(payload.sub || payload.id),
            email:
              typeof payload.email === 'string'
                ? payload.email
                : `${payload.sub || payload.id}@promptlab.local`,
            displayName:
              typeof payload.name === 'string'
                ? payload.name
                : typeof payload.displayName === 'string'
                  ? payload.displayName
                  : 'User',
            role: payload.role === 'admin' ? 'admin' : 'user',
          };
        }
      } catch {
        // Verification failed (invalid signature, expired, alg: none, wrong secret, wrong iss/aud)
      }
    }

    return null;
  }
}
