import { ExecutionContext, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { ConversationsService } from '../../conversations/conversations.service';
import { UsageController } from '../../usage/usage.controller';
import { ObservabilityController } from '../../observability/observability.controller';

describe('SEC-01 / SEC-01a: Authentication, Authorization, Ownership, and Demo Gating', () => {
  let reflector: Reflector;
  let configService: ConfigService;
  let jwtService: JwtService;
  let authGuard: AuthGuard;
  let rolesGuard: RolesGuard;

  const validJwtSecret = 'super-secure-production-jwt-secret-min-32-chars';

  beforeEach(() => {
    reflector = new Reflector();
    configService = new ConfigService();
    jwtService = new JwtService();

    // Default configuration for tests: dev tokens enabled, valid JWT secret, sample API keys
    process.env.NODE_ENV = 'development';
    process.env.AUTH_DEV_TOKENS_ENABLED = 'true';
    process.env.AUTH_DEV_ADMIN_TOKEN = 'dev-admin-token';
    process.env.AUTH_DEV_USER_TOKEN = 'dev-user-token';
    process.env.AUTH_JWT_SECRET = validJwtSecret;
    process.env.AUTH_API_KEYS = 'test-key-admin:admin-01:admin,test-key-user:user-02:user';
    process.env.LITELLM_MASTER_KEY = 'sk-litellm-proxy-master-secret';

    authGuard = new AuthGuard(reflector, configService, jwtService);
    rolesGuard = new RolesGuard(reflector);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createMockContext(headers: Record<string, string> = {}, user?: unknown): ExecutionContext {
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

  describe('AuthGuard (SEC-01a Security Invariants)', () => {
    it('allows public routes decorated with @Public() without any credentials', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const ctx = createMockContext();
      await expect(authGuard.canActivate(ctx)).resolves.toBe(true);
    });

    it('rejects unauthenticated requests with HTTP 401 UnauthorizedException', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const ctx = createMockContext({});
      await expect(authGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects forged base64 JSON payload with HTTP 401', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      // Base64 encoding of {"sub":"evil","role":"admin"} — MUST NOT be accepted
      const forgedBase64 = Buffer.from(JSON.stringify({ sub: 'evil', role: 'admin' })).toString('base64');
      const ctx = createMockContext({ authorization: `Bearer ${forgedBase64}` });

      await expect(authGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects unsigned "alg: none" JWT with HTTP 401', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      // Header: {"alg":"none","typ":"JWT"}, Payload: {"sub":"evil","role":"admin"}
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: 'evil', role: 'admin' })).toString('base64url');
      const unsignedJwt = `${header}.${payload}.`;
      const ctx = createMockContext({ authorization: `Bearer ${unsignedJwt}` });

      await expect(authGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects JWT signed with the wrong secret with HTTP 401', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const wrongSecret = 'some-other-unauthorized-secret-string-at-least-32-chars';
      const token = jwtService.sign({ sub: 'attacker', role: 'admin' }, { secret: wrongSecret, algorithm: 'HS256' });
      const ctx = createMockContext({ authorization: `Bearer ${token}` });

      await expect(authGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects expired JWT with HTTP 401', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const expiredToken = jwtService.sign(
        { sub: 'legit-user', role: 'user', exp: Math.floor(Date.now() / 1000) - 120 },
        { secret: validJwtSecret, algorithm: 'HS256' },
      );
      const ctx = createMockContext({ authorization: `Bearer ${expiredToken}` });

      await expect(authGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects dev-admin-token when NODE_ENV is production with HTTP 401', async () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_DEV_TOKENS_ENABLED = 'true'; // Ignored in production
      authGuard.reloadConfig();

      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const ctx = createMockContext({ authorization: 'Bearer dev-admin-token' });

      await expect(authGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects LITELLM_MASTER_KEY when presented as a bearer token with HTTP 401', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const ctx = createMockContext({ authorization: 'Bearer sk-litellm-proxy-master-secret' });

      await expect(authGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('authenticates valid dev-admin-token in development when AUTH_DEV_TOKENS_ENABLED=true', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const ctx = createMockContext({ authorization: 'Bearer dev-admin-token' });
      const canActivate = await authGuard.canActivate(ctx);
      const req = ctx.switchToHttp().getRequest() as { user: { role: string; id: string } };

      expect(canActivate).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user.role).toBe('admin');
      expect(req.user.id).toBe('dev-user-001');
    });

    it('authenticates valid dev-user-token in development when AUTH_DEV_TOKENS_ENABLED=true', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const ctx = createMockContext({ authorization: 'Bearer dev-user-token' });
      const canActivate = await authGuard.canActivate(ctx);
      const req = ctx.switchToHttp().getRequest() as { user: { role: string; id: string } };

      expect(canActivate).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user.role).toBe('user');
      expect(req.user.id).toBe('user-002');
    });

    it('authenticates configured API key via x-api-key header and timingSafeEqual', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const ctx = createMockContext({ 'x-api-key': 'test-key-admin' });
      const canActivate = await authGuard.canActivate(ctx);
      const req = ctx.switchToHttp().getRequest() as { user: { role: string; id: string } };

      expect(canActivate).toBe(true);
      expect(req.user.role).toBe('admin');
      expect(req.user.id).toBe('admin-01');
    });

    it('authenticates valid cryptographically signed JWT', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const validToken = jwtService.sign(
        { sub: 'user-jwt-123', role: 'user', email: 'jwt@promptlab.local' },
        { secret: validJwtSecret, algorithm: 'HS256' },
      );
      const ctx = createMockContext({ authorization: `Bearer ${validToken}` });
      const canActivate = await authGuard.canActivate(ctx);
      const req = ctx.switchToHttp().getRequest() as { user: { role: string; id: string } };

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
      await expect(service.findOne('conv-123', 'user-A')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-123', ownerId: 'user-A' },
        }),
      );
    });
  });

  describe('Demo Endpoint Gating (Production Hardening)', () => {
    const origEnv = process.env;

    beforeEach(() => {
      process.env = { ...origEnv };
    });

    afterAll(() => {
      process.env = origEnv;
    });

    it('rejects POST /usage/reset when ENABLE_DEMO_ENDPOINTS is not true', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ENABLE_DEMO_ENDPOINTS = 'false';

      const usageService = { resetPeriodForDemo: jest.fn() } as any;
      const controller = new UsageController(usageService);

      await expect(controller.resetPeriod()).rejects.toThrow(ForbiddenException);
      expect(usageService.resetPeriodForDemo).not.toHaveBeenCalled();
    });

    it('rejects POST /usage/reset when NODE_ENV is production even if ENABLE_DEMO_ENDPOINTS is true', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_DEMO_ENDPOINTS = 'true';

      const usageService = { resetPeriodForDemo: jest.fn() } as any;
      const controller = new UsageController(usageService);

      await expect(controller.resetPeriod()).rejects.toThrow(ForbiddenException);
      expect(usageService.resetPeriodForDemo).not.toHaveBeenCalled();
    });

    it('rejects POST /observability/clear when ENABLE_DEMO_ENDPOINTS is not true', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.ENABLE_DEMO_ENDPOINTS;

      const obsService = { clearTraces: jest.fn() } as any;
      const controller = new ObservabilityController(obsService);

      expect(() => controller.clearTraces()).toThrow(ForbiddenException);
      expect(obsService.clearTraces).not.toHaveBeenCalled();
    });
  });
});
