import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { ConversationsService } from '../../conversations/conversations.service';
import { ExperimentsService } from '../../experiments/experiments.service';
import { UsageController } from '../../usage/usage.controller';
import { ObservabilityController } from '../../observability/observability.controller';
import { validateEnvironment } from '../config/env.validation';

describe('SEC-01 / SEC-01a-2: Authentication & Authorization Security Invariants', () => {
  let reflector: Reflector;
  let jwtService: JwtService;
  let rolesGuard: RolesGuard;
  const origEnv = process.env;

  const validJwtSecret =
    'super-secure-production-jwt-secret-min-32-chars-long!';

  beforeEach(() => {
    process.env = { ...origEnv };
    reflector = new Reflector();
    jwtService = new JwtService();
    rolesGuard = new RolesGuard(reflector);

    // Setup valid development environment
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL =
      'postgresql://postgres:admin@localhost:5432/promptlab';
    process.env.AUTH_DEV_TOKENS_ENABLED = 'true';
    process.env.AUTH_DEV_ADMIN_TOKEN = 'dev-admin-token';
    process.env.AUTH_DEV_USER_TOKEN = 'dev-user-token';
    process.env.AUTH_JWT_SECRET = validJwtSecret;
    process.env.AUTH_API_KEYS =
      'test-key-admin-at-least-32-characters-long:admin-01:admin,test-key-user-at-least-32-characters-long:user-02:user';
    process.env.LITELLM_MASTER_KEY = 'sk-litellm-proxy-master-secret-32-chars';
  });

  afterEach(() => {
    process.env = origEnv;
    jest.restoreAllMocks();
  });

  function createAuthGuard(
    envOverrides: Record<string, string | undefined> = {},
    prismaService?: any,
  ) {
    const mergedEnv = { ...process.env, ...envOverrides };
    const validatedConfig = validateEnvironment(mergedEnv);
    return new AuthGuard(reflector, validatedConfig, jwtService, prismaService);
  }

  function createMockContext(
    headers: Record<string, string> = {},
    user?: unknown,
  ): ExecutionContext {
    const request: Record<string, unknown> = { headers, user };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  describe('AuthGuard (SEC-01a-2 Security Rejections)', () => {
    it('allows public routes decorated with @Public() without any credentials', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const guard = createAuthGuard();
      const ctx = createMockContext();
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('rejects unauthenticated requests with HTTP 401 UnauthorizedException', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard();
      const ctx = createMockContext({});
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects dev-admin-token when NODE_ENV is unset (treated as production) with HTTP 401', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      // Unset NODE_ENV, provide valid production keys so validateEnvironment doesn't fail
      const guard = createAuthGuard({
        NODE_ENV: undefined,
        AUTH_DEV_TOKENS_ENABLED: 'true',
        AUTH_DEV_ADMIN_TOKEN: 'dev-admin-token',
        AUTH_API_KEYS:
          'production-api-key-32-chars-long-minimum-here:admin-01:admin',
      });
      const ctx = createMockContext({ authorization: 'Bearer dev-admin-token' });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects dev tokens when AUTH_DEV_TOKENS_ENABLED=true but specific tokens are unset', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard({
        AUTH_DEV_TOKENS_ENABLED: 'true',
        AUTH_DEV_ADMIN_TOKEN: undefined,
        AUTH_DEV_USER_TOKEN: undefined,
      });
      const ctx = createMockContext({ authorization: 'Bearer dev-admin-token' });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects forged base64 JSON payload with HTTP 401', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard();
      const forgedBase64 = Buffer.from(
        JSON.stringify({ sub: 'evil', role: 'admin' }),
      ).toString('base64');
      const ctx = createMockContext({ authorization: `Bearer ${forgedBase64}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects unsigned "alg: none" JWT with HTTP 401', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard();
      const header = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' }),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ sub: 'evil', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 }),
      ).toString('base64url');
      const unsignedJwt = `${header}.${payload}.`;
      const ctx = createMockContext({ authorization: `Bearer ${unsignedJwt}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects JWT signed with the wrong secret with HTTP 401', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard();
      const wrongSecret =
        'some-other-unauthorized-secret-string-at-least-32-chars';
      const token = jwtService.sign(
        { sub: 'attacker', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 },
        { secret: wrongSecret, algorithm: 'HS256' },
      );
      const ctx = createMockContext({ authorization: `Bearer ${token}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects JWT with NO exp claim even if signed correctly with HTTP 401', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard();
      // Notice: no exp claim passed
      const tokenWithoutExp = jwtService.sign(
        { sub: 'legit-user', role: 'user' },
        { secret: validJwtSecret, algorithm: 'HS256' },
      );
      const ctx = createMockContext({ authorization: `Bearer ${tokenWithoutExp}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects JWT with exp one year ahead and NO iat claim with HTTP 401 (SEC-01a-3)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard();
      const oneYearAhead = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
      // Exp is 1 year in future, but iat is not set
      const tokenWithoutIat = jwtService.sign(
        { sub: 'attacker-skipping-lifetime', role: 'admin', exp: oneYearAhead },
        { secret: validJwtSecret, algorithm: 'HS256', noTimestamp: true },
      );
      const ctx = createMockContext({ authorization: `Bearer ${tokenWithoutIat}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects JWT with iat in the future beyond 60s clock skew with HTTP 401 (SEC-01a-3)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard();
      const now = Math.floor(Date.now() / 1000);
      const tokenFutureIat = jwtService.sign(
        { sub: 'user-1', role: 'user', iat: now + 300, exp: now + 3600 },
        { secret: validJwtSecret, algorithm: 'HS256' },
      );
      const ctx = createMockContext({ authorization: `Bearer ${tokenFutureIat}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects expired JWT with HTTP 401', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard();
      const expiredToken = jwtService.sign(
        {
          sub: 'legit-user',
          role: 'user',
          exp: Math.floor(Date.now() / 1000) - 120,
        },
        { secret: validJwtSecret, algorithm: 'HS256' },
      );
      const ctx = createMockContext({ authorization: `Bearer ${expiredToken}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects JWT whose lifetime (exp - iat) exceeds max configured lifetime', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      // Max lifetime set to 3600s (1 hour)
      const guard = createAuthGuard({
        AUTH_JWT_MAX_LIFETIME_SECONDS: '3600',
      });
      const now = Math.floor(Date.now() / 1000);
      const tokenExceedingLifetime = jwtService.sign(
        {
          sub: 'legit-user',
          role: 'user',
          iat: now,
          exp: now + 7200, // 2 hours > 1 hour
        },
        { secret: validJwtSecret, algorithm: 'HS256' },
      );
      const ctx = createMockContext({ authorization: `Bearer ${tokenExceedingLifetime}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects JWT when issuer or audience does not match configured values', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard({
        AUTH_JWT_ISSUER: 'https://auth.promptlab.internal',
        AUTH_JWT_AUDIENCE: 'promptlab-api',
      });

      const now = Math.floor(Date.now() / 1000);
      const tokenWrongIssuer = jwtService.sign(
        {
          sub: 'legit-user',
          role: 'user',
          iss: 'https://wrong-issuer.com',
          aud: 'promptlab-api',
          exp: now + 300,
        },
        { secret: validJwtSecret, algorithm: 'HS256' },
      );

      const ctx = createMockContext({ authorization: `Bearer ${tokenWrongIssuer}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects dev-admin-token when NODE_ENV is production with HTTP 401', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard({
        NODE_ENV: 'production',
        AUTH_DEV_TOKENS_ENABLED: 'true',
        AUTH_API_KEYS:
          'production-api-key-32-chars-long-minimum-here:admin-01:admin',
      });

      const ctx = createMockContext({ authorization: 'Bearer dev-admin-token' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects LITELLM_MASTER_KEY when presented as a bearer token with HTTP 401', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard();
      const ctx = createMockContext({
        authorization: 'Bearer sk-litellm-proxy-master-secret-32-chars',
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('authenticates valid dev-admin-token in development when configured', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard();
      const ctx = createMockContext({ authorization: 'Bearer dev-admin-token' });
      const canActivate = await guard.canActivate(ctx);
      const req = ctx.switchToHttp().getRequest() as {
        user: { role: string; id: string };
      };

      expect(canActivate).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user.role).toBe('admin');
      expect(req.user.id).toBe('dev-user-001');
    });

    it('authenticates valid API key via x-api-key header and timingSafeEqual', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard();
      const ctx = createMockContext({
        'x-api-key': 'test-key-admin-at-least-32-characters-long',
      });
      const canActivate = await guard.canActivate(ctx);
      const req = ctx.switchToHttp().getRequest() as {
        user: { role: string; id: string };
      };

      expect(canActivate).toBe(true);
      expect(req.user.role).toBe('admin');
      expect(req.user.id).toBe('admin-01');
    });

    it('authenticates valid cryptographically signed JWT with exp claim', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const guard = createAuthGuard();
      const now = Math.floor(Date.now() / 1000);
      const validToken = jwtService.sign(
        {
          sub: 'user-jwt-123',
          role: 'user',
          email: 'jwt@promptlab.local',
          iat: now,
          exp: now + 3600,
        },
        { secret: validJwtSecret, algorithm: 'HS256' },
      );
      const ctx = createMockContext({ authorization: `Bearer ${validToken}` });
      const canActivate = await guard.canActivate(ctx);
      const req = ctx.switchToHttp().getRequest() as {
        user: { role: string; id: string };
      };

      expect(canActivate).toBe(true);
      expect(req.user.id).toBe('user-jwt-123');
      expect(req.user.role).toBe('user');
    });
  });

  describe('RolesGuard (Authorization)', () => {
    it('allows request if no roles are required on the route', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const ctx = createMockContext({}, { role: 'user' });
      expect(rolesGuard.canActivate(ctx)).toBe(true);
    });

    it('allows user with matching role to access admin route', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
      const ctx = createMockContext({}, { id: 'admin-1', role: 'admin' });
      expect(rolesGuard.canActivate(ctx)).toBe(true);
    });

    it('rejects non-admin users attempting to access admin route with HTTP 403 ForbiddenException', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
      const ctx = createMockContext({}, { id: 'user-2', role: 'user' });
      expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  describe('Ownership Scoping (IDOR Prevention)', () => {
    it('returns HTTP 404 NotFoundException when User A attempts to fetch User B conversation', async () => {
      const mockPrisma = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as any;

      const service = new ConversationsService(
        mockPrisma,
        {} as any,
        {} as any,
        {} as any,
      );

      // User A (user-A) requests conversation conv-123 owned by User B (user-B)
      await expect(service.findOne('conv-123', 'user-A')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-123', ownerId: 'user-A' },
        }),
      );
    });

    it('returns HTTP 404 NotFoundException when User A attempts to fetch User B experiment', async () => {
      const mockPrisma = {
        experiment: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as any;

      const service = new ExperimentsService(
        mockPrisma,
        {} as any,
        {} as any,
      );

      await expect(service.findById('exp-123', 'user-A')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.experiment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exp-123', ownerId: 'user-A' },
        }),
      );
    });

    it('RolesGuard rejects non-admin user on admin-scoped endpoints (/settings, /observability/traces)', () => {
      const guard = new RolesGuard(reflector);
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);

      const userCtx = createMockContext({}, { id: 'user-002', role: 'user' });
      expect(() => guard.canActivate(userCtx)).toThrow(ForbiddenException);

      const adminCtx = createMockContext({}, { id: 'admin-001', role: 'admin' });
      expect(guard.canActivate(adminCtx)).toBe(true);
    });
  });

  describe('Demo Endpoint Gating (SEC-01a-2 Allow-list Enforcement)', () => {
    it('rejects POST /usage/reset when NODE_ENV is unset even if ENABLE_DEMO_ENDPOINTS is true', async () => {
      delete process.env.NODE_ENV;
      process.env.ENABLE_DEMO_ENDPOINTS = 'true';

      const usageService = { resetPeriodForDemo: jest.fn() } as any;
      const controller = new UsageController(usageService, validateEnvironment());

      await expect(controller.resetPeriod('admin-user-001')).rejects.toThrow(ForbiddenException);
      expect(usageService.resetPeriodForDemo).not.toHaveBeenCalled();
    });

    it('rejects POST /usage/reset when NODE_ENV is staging even if ENABLE_DEMO_ENDPOINTS is true', async () => {
      process.env.NODE_ENV = 'staging';
      process.env.ENABLE_DEMO_ENDPOINTS = 'true';

      const usageService = { resetPeriodForDemo: jest.fn() } as any;
      const controller = new UsageController(usageService, validateEnvironment());

      await expect(controller.resetPeriod('admin-user-001')).rejects.toThrow(ForbiddenException);
      expect(usageService.resetPeriodForDemo).not.toHaveBeenCalled();
    });

    it('rejects POST /usage/reset when NODE_ENV is production even if ENABLE_DEMO_ENDPOINTS is true', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_DEMO_ENDPOINTS = 'true';

      const usageService = { resetPeriodForDemo: jest.fn() } as any;
      const controller = new UsageController(usageService, validateEnvironment());

      await expect(controller.resetPeriod('admin-user-001')).rejects.toThrow(ForbiddenException);
      expect(usageService.resetPeriodForDemo).not.toHaveBeenCalled();
    });

    it('allows POST /usage/reset ONLY when NODE_ENV is development AND ENABLE_DEMO_ENDPOINTS is true', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ENABLE_DEMO_ENDPOINTS = 'true';

      const usageService = { resetPeriodForDemo: jest.fn().mockReturnValue({ success: true }) } as any;
      const controller = new UsageController(usageService, validateEnvironment());

      await expect(controller.resetPeriod('admin-user-001')).resolves.toEqual({ success: true });
      expect(usageService.resetPeriodForDemo).toHaveBeenCalledWith('admin-user-001');
    });

    it('rejects POST /observability/clear when NODE_ENV is not in allow-list', () => {
      delete process.env.NODE_ENV;
      process.env.ENABLE_DEMO_ENDPOINTS = 'true';

      const obsService = { clearTraces: jest.fn() } as any;
      const controller = new ObservabilityController(obsService, validateEnvironment());

      expect(() => controller.clearTraces()).toThrow(ForbiddenException);
      expect(obsService.clearTraces).not.toHaveBeenCalled();
    });
  });

  describe('User Auto-Provisioning on Authentication (SEC-01e)', () => {
    it('upserts authenticated user into database on first request and caches it for subsequent calls', async () => {
      const mockPrisma = {
        user: {
          upsert: jest.fn().mockResolvedValue({
            id: 'user-002',
            email: 'user2@promptlab.local',
            displayName: 'Test User',
            role: 'user',
          }),
        },
      };

      const guard = createAuthGuard({}, mockPrisma);
      const ctx = createMockContext({ authorization: 'Bearer dev-user-token' });

      // First request -> should trigger upsert
      const allowed1 = await guard.canActivate(ctx);
      expect(allowed1).toBe(true);
      expect(mockPrisma.user.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.upsert).toHaveBeenCalledWith({
        where: { id: 'user-002' },
        update: { role: 'user', displayName: 'Test User' },
        create: {
          id: 'user-002',
          email: 'user2@promptlab.local',
          displayName: 'Test User',
          role: 'user',
        },
      });

      // Second request -> cached in memory, should NOT call upsert again
      const allowed2 = await guard.canActivate(ctx);
      expect(allowed2).toBe(true);
      expect(mockPrisma.user.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
