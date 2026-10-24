import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { DEFAULT_DEV_USER } from '../constants/auth.constants';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
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
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (apiKeyHeader && typeof apiKeyHeader === 'string') {
      token = apiKeyHeader.trim();
    }

    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = this.resolveUserFromToken(token);
    if (!user) {
      throw new UnauthorizedException('Invalid authentication credentials');
    }

    request.user = user;
    return true;
  }

  private resolveUserFromToken(token: string): AuthenticatedUser | null {
    // 1. Static dev/test tokens (for local development, automated suites, and E2E)
    if (
      token === 'dev-admin-token' ||
      token === 'test-admin-token' ||
      token === 'sk-promptlab-dev-key'
    ) {
      return {
        id: DEFAULT_DEV_USER.id,
        email: DEFAULT_DEV_USER.email,
        displayName: DEFAULT_DEV_USER.displayName,
        role: 'admin',
      };
    }

    if (token === 'dev-user-token' || token === 'test-user-token') {
      return {
        id: 'user-002',
        email: 'user2@promptlab.local',
        displayName: 'Test User',
        role: 'user',
      };
    }

    // 2. Configured Master Key matches admin
    const masterKey = this.configService.get<string>('LITELLM_MASTER_KEY');
    if (masterKey && token === masterKey) {
      return {
        id: DEFAULT_DEV_USER.id,
        email: DEFAULT_DEV_USER.email,
        displayName: DEFAULT_DEV_USER.displayName,
        role: 'admin',
      };
    }

    // 3. Simple JWT / Base64 JSON token payload support
    try {
      const parts = token.split('.');
      const payloadStr =
        parts.length === 3
          ? Buffer.from(parts[1], 'base64').toString('utf-8')
          : Buffer.from(token, 'base64').toString('utf-8');
      const payload = JSON.parse(payloadStr);
      if (payload && (payload.sub || payload.id)) {
        return {
          id: payload.sub || payload.id,
          email: payload.email || 'user@promptlab.local',
          displayName: payload.name || payload.displayName || 'User',
          role: payload.role || 'user',
        };
      }
    } catch {
      // not a base64 payload
    }

    return null;
  }
}
