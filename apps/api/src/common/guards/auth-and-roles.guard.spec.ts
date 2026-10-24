import { ExecutionContext, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { ConversationsService } from '../../conversations/conversations.service';
import { UsageController } from '../../usage/usage.controller';
import { ObservabilityController } from '../../observability/observability.controller';

describe('SEC-01: Authentication, Authorization, Ownership, and Demo Gating', () => {
  let reflector: Reflector;
  let configService: ConfigService;
  let authGuard: AuthGuard;
  let rolesGuard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    configService = new ConfigService();
    authGuard = new AuthGuard(reflector, configService);
    rolesGuard = new RolesGuard(reflector);
  });

  function createMockContext(headers: Record<string, string> = {}, user?: any): ExecutionContext {
    const request: any = { headers, user };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  describe('AuthGuard (Authentication)', () => {
    it('allows public routes decorated with @Public() without any credentials', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const ctx = createMockContext();
      expect(authGuard.canActivate(ctx)).toBe(true);
    });

    it('rejects unauthenticated requests with HTTP 401 UnauthorizedException', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const ctx = createMockContext({});
      expect(() => authGuard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('rejects invalid credentials with HTTP 401 UnauthorizedException', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const ctx = createMockContext({ authorization: 'Bearer invalid-token-xyz' });
      expect(() => authGuard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('authenticates valid dev-admin-token and populates request.user with admin role', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const ctx = createMockContext({ authorization: 'Bearer dev-admin-token' });
      const canActivate = authGuard.canActivate(ctx);
      const req = ctx.switchToHttp().getRequest();

      expect(canActivate).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user.role).toBe('admin');
      expect(req.user.id).toBe('dev-user-001');
    });

    it('authenticates valid dev-user-token and populates request.user with user role', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const ctx = createMockContext({ authorization: 'Bearer dev-user-token' });
      const canActivate = authGuard.canActivate(ctx);
      const req = ctx.switchToHttp().getRequest();

      expect(canActivate).toBe(true);
      expect(req.user).toBeDefined();
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
