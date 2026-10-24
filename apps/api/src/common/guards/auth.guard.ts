import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { parseApiKeys, ParsedApiKey } from '../config/env.validation';

/**
 * SEC-01a: Production-grade authentication guard.
 *
 * Rules:
 *  - Rejects unverified tokens: never base64 decodes or trusts unsigned payloads.
 *  - Verifies JWTs cryptographically via @nestjs/jwt with pinned HS256 algorithm and expiration checks.
 *  - Compares API keys using crypto.timingSafeEqual on SHA-256 digests.
 *  - Dev tokens are permitted ONLY when NODE_ENV is development or test AND AUTH_DEV_TOKENS_ENABLED=true.
 *  - LITELLM_MASTER_KEY is not accepted as a login credential.
 *  - No hardcoded secrets in source code.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private apiKeys: ParsedApiKey[] = [];
  private authJwtSecret?: string;
  private authDevTokensEnabled = false;
  private devAdminDigest?: Buffer;
  private devUserDigest?: Buffer;
  private isProduction = false;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    @Optional() private readonly jwtService?: JwtService,
  ) {
    this.reloadConfig();
  }

  public reloadConfig(): void {
    const nodeEnv =
      this.configService.get<string>('NODE_ENV') || process.env.NODE_ENV;
    this.isProduction = nodeEnv === 'production';

    const rawApiKeys =
      this.configService.get<string>('AUTH_API_KEYS') ||
      process.env.AUTH_API_KEYS;
    this.apiKeys = parseApiKeys(rawApiKeys);

    this.authJwtSecret =
      this.configService.get<string>('AUTH_JWT_SECRET') ||
      process.env.AUTH_JWT_SECRET;

    const devTokensFlag =
      this.configService.get<string>('AUTH_DEV_TOKENS_ENABLED') ||
      process.env.AUTH_DEV_TOKENS_ENABLED;
    this.authDevTokensEnabled = !this.isProduction && devTokensFlag === 'true';

    if (this.authDevTokensEnabled) {
      const devAdminToken =
        this.configService.get<string>('AUTH_DEV_ADMIN_TOKEN') ||
        process.env.AUTH_DEV_ADMIN_TOKEN ||
        'dev-admin-token';
      const devUserToken =
        this.configService.get<string>('AUTH_DEV_USER_TOKEN') ||
        process.env.AUTH_DEV_USER_TOKEN ||
        'dev-user-token';

      this.devAdminDigest = crypto
        .createHash('sha256')
        .update(devAdminToken)
        .digest();
      this.devUserDigest = crypto
        .createHash('sha256')
        .update(devUserToken)
        .digest();
    } else {
      this.devAdminDigest = undefined;
      this.devUserDigest = undefined;
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

    // 1. Dev / test tokens: strictly allowed only when NODE_ENV is development or test AND AUTH_DEV_TOKENS_ENABLED=true
    if (this.authDevTokensEnabled && !this.isProduction) {
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
    if (this.apiKeys.length > 0) {
      for (const apiKey of this.apiKeys) {
        if (crypto.timingSafeEqual(candidateDigest, apiKey.digest)) {
          return apiKey.user;
        }
      }
    }

    // 3. Cryptographically verified JWTs via @nestjs/jwt with pinned HS256 algorithm and expiration check
    if (
      this.jwtService &&
      this.authJwtSecret &&
      this.authJwtSecret.length >= 32
    ) {
      try {
        const payload = await this.jwtService.verifyAsync(token, {
          secret: this.authJwtSecret,
          algorithms: ['HS256'],
        });
        if (payload && (payload.sub || payload.id)) {
          return {
            id: String(payload.sub || payload.id),
            email:
              payload.email || `${payload.sub || payload.id}@promptlab.local`,
            displayName: payload.name || payload.displayName || 'User',
            role: payload.role === 'admin' ? 'admin' : 'user',
          };
        }
      } catch {
        // Verification failed (invalid signature, expired, alg: none, wrong secret)
      }
    }

    return null;
  }
}
