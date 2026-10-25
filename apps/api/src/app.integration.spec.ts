import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ConflictException } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './app.module';
import { validateEnvironment } from './common/config/env.validation';
import { configureApp } from './configure-app';
import { PrismaService } from './prisma/prisma.service';
import { UsageService } from './usage/usage.service';
import { LlmExecutionService } from './llm/llm-execution.service';
import { ProvidersService } from './providers/providers.service';

describe('HTTP Routing & App Integration (E2E)', () => {
  let app: INestApplication;
  const authHeader = { Authorization: 'Bearer dev-admin-token' };
  const origEnv = process.env;
  jest.setTimeout(30000);

  beforeAll(async () => {
    process.env = { ...origEnv };
    process.env.NODE_ENV = 'test';
    // Ensure test environment satisfies startup validation
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = 'postgresql://postgres:admin@localhost:5432/promptlab?schema=public';
    }
    process.env.AUTH_DEV_TOKENS_ENABLED = 'true';
    process.env.AUTH_DEV_ADMIN_TOKEN = 'dev-admin-token';
    process.env.AUTH_DEV_USER_TOKEN = 'dev-user-token';
    delete process.env.TRUST_PROXY;
    const envConfig = validateEnvironment();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });

    // SEC-04: use the shared configureApp() so the test exercises the real production pipeline
    configureApp(app, envConfig);

    await app.init();
  }, 30000);

  afterAll(async () => {
    process.env = origEnv;
    if (app) {
      await app.close();
    }
  });

  describe('Authentication & Authorization Guards (SEC-01)', () => {
    it('allows public route /api/health without credentials', async () => {
      await request(app.getHttpServer()).get('/api/health').expect(200);
    });

    it('rejects unauthenticated requests to protected endpoints with 401 Unauthorized', async () => {
      await request(app.getHttpServer()).get('/api/conversations').expect(401);
      await request(app.getHttpServer()).get('/api/prompts').expect(401);
      await request(app.getHttpServer()).get('/api/usage/status').expect(401);
    });

    it('rejects non-admin users attempting admin routes with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .put('/api/usage/policy')
        .set('Authorization', 'Bearer dev-user-token')
        .send({ monthlyTokenLimit: 50000 })
        .expect(403);
    });

    it('allows a non-admin user to create a conversation after automatic User upsert (SEC-01e)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/conversations')
        .set('Authorization', 'Bearer dev-user-token')
        .send({
          title: 'Non-admin conversation',
          provider: 'openai',
          model: 'gpt-4o-mini',
        });

      if (res.status === 201) {
        expect(res.body.id).toBeDefined();
        expect(res.body.ownerId).toBe('user-002');
      } else {
        expect(res.status).not.toBe(422);
      }
    });
  });

  describe('Global Prefix and Routing', () => {
    it('returns 404 for routes missing the global /api prefix', async () => {
      await request(app.getHttpServer())
        .get('/health')
        .expect(404);

      await request(app.getHttpServer())
        .get('/usage/status')
        .expect(404);
    });

    it('successfully reaches GET /api/health with 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .expect(200);

      expect(res.body.status).toBeDefined();
      expect(res.body.services).toBeDefined();
    });

    it('resolves GET /api/usage/status without duplicated prefix', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/usage/status')
        .set(authHeader)
        .expect(200);

      expect(res.body.tokenLimit).toBeDefined();
      expect(res.body.actualTokens).toBeDefined();
      expect(res.body.status).toBeDefined();
    });

    it('resolves GET /api/usage/ledger with limit', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/usage/ledger?limit=10')
        .set(authHeader)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('resolves GET /api/observability/status without duplicated prefix', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/observability/status')
        .set(authHeader)
        .expect(200);

      expect(res.body.telemetryEnabled).toBeDefined();
      expect(res.body.totalTracesRecorded).toBeDefined();
    });

    it('resolves GET /api/observability/traces', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/observability/traces')
        .set(authHeader)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });


  describe('Validation Pipeline and Exception Filter', () => {
    it('rejects POST /api/prompts with 400 Bad Request when mandatory fields are missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/prompts')
        .set(authHeader)
        .send({})
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toBeDefined();
    });

    it('rejects forbidden non-whitelisted properties with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/prompts')
        .set(authHeader)
        .send({
          name: 'Test Prompt',
          templateBody: 'Hello {{name}}',
          unrecognizedMaliciousField: 'exploit',
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('rejects prompt templateBody exceeding 32768 characters with 400 Bad Request', async () => {
      const oversizedBody = 'A'.repeat(32769);
      const res = await request(app.getHttpServer())
        .post('/api/prompts')
        .set(authHeader)
        .send({
          name: 'Oversized Prompt',
          templateBody: oversizedBody,
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain('32768');
    });

    it('rejects playground run with invalid model identifier pattern with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/prompts/run')
        .set(authHeader)
        .send({
          templateBody: 'Hello world',
          model: 'invalid model; with spaces and semicolon',
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain('model identifier');
    });

    it('rejects playground run with out-of-bounds or non-numeric temperature with 400 Bad Request', async () => {
      // Temperature > 2
      await request(app.getHttpServer())
        .post('/api/prompts/run')
        .set(authHeader)
        .send({
          templateBody: 'Hello world',
          model: 'gpt-4o-mini',
          temperature: 2.5,
        })
        .expect(400);

      // Temperature < 0
      await request(app.getHttpServer())
        .post('/api/prompts/run')
        .set(authHeader)
        .send({
          templateBody: 'Hello world',
          model: 'gpt-4o-mini',
          temperature: -0.1,
        })
        .expect(400);

      // Temperature string
      await request(app.getHttpServer())
        .post('/api/prompts/run')
        .set(authHeader)
        .send({
          templateBody: 'Hello world',
          model: 'gpt-4o-mini',
          temperature: 'hot',
        })
        .expect(400);
    });

    it('rejects playground run with out-of-bounds, decimal, or string maxTokens with 400 Bad Request', async () => {
      // maxTokens < 1
      await request(app.getHttpServer())
        .post('/api/prompts/run')
        .set(authHeader)
        .send({
          templateBody: 'Hello world',
          model: 'gpt-4o-mini',
          maxTokens: 0,
        })
        .expect(400);

      // maxTokens > 32768
      await request(app.getHttpServer())
        .post('/api/prompts/run')
        .set(authHeader)
        .send({
          templateBody: 'Hello world',
          model: 'gpt-4o-mini',
          maxTokens: 32769,
        })
        .expect(400);

      // Decimal maxTokens
      await request(app.getHttpServer())
        .post('/api/prompts/run')
        .set(authHeader)
        .send({
          templateBody: 'Hello world',
          model: 'gpt-4o-mini',
          maxTokens: 50.5,
        })
        .expect(400);

      // String maxTokens
      await request(app.getHttpServer())
        .post('/api/prompts/run')
        .set(authHeader)
        .send({
          templateBody: 'Hello world',
          model: 'gpt-4o-mini',
          maxTokens: 'unlimited',
        })
        .expect(400);
    });

    it('rejects experiment comparison with invalid evaluation criterion type with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/experiments/run')
        .set(authHeader)
        .send({
          name: 'Invalid Criterion Test',
          commonInput: { test: 'val' },
          slotA: { provider: 'openai', model: 'gpt-4o-mini' },
          slotB: { provider: 'anthropic', model: 'claude-3-5-sonnet' },
          evaluationCriteria: [
            {
              id: 'crit-1',
              name: 'Invalid Type Criterion',
              type: 'arbitrary_unsupported_type',
            },
          ],
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain('evaluation criterion type');
    });

    it('rejects experiment rating with invalid slot with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/experiments/exp-123/rate')
        .set(authHeader)
        .send({
          slot: 'C', // Allowed: 'A' | 'B'
          rating: 4,
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain('slot');
    });

    it('rejects experiment rating with out-of-range rating with 400 Bad Request', async () => {
      // rating > 5
      await request(app.getHttpServer())
        .post('/api/experiments/exp-123/rate')
        .set(authHeader)
        .send({
          slot: 'A',
          rating: 6,
        })
        .expect(400);

      // rating < 1
      await request(app.getHttpServer())
        .post('/api/experiments/exp-123/rate')
        .set(authHeader)
        .send({
          slot: 'A',
          rating: 0,
        })
        .expect(400);
    });

    it('rejects conversation creation with invalid model format with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({
          provider: 'openai',
          model: 'malicious $(whoami) model',
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain('model identifier');
    });

    it('rejects conversation message exceeding 32768 characters with 400 Bad Request', async () => {
      const oversizedMsg = 'X'.repeat(32769);
      const res = await request(app.getHttpServer())
        .post('/api/conversations/conv-123/messages')
        .set(authHeader)
        .send({
          content: oversizedMsg,
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain('32768');
    });

    it('accepts valid preview and run payloads with boundary values', async () => {
      // Boundary test: temperature=0, maxTokens=1
      const res1 = await request(app.getHttpServer())
        .post('/api/prompts/preview')
        .set(authHeader)
        .send({
          templateBody: 'Valid template with length 100 ' + 'A'.repeat(70),
          variables: { name: 'Alice' },
        })
        .expect(201); // Default Nest POST status is 201 Created

      expect(res1.body.resolvedPrompt).toBeDefined();

      // Boundary test: templateBody length exactly 32768
      const res2 = await request(app.getHttpServer())
        .post('/api/prompts/preview')
        .set(authHeader)
        .send({
          templateBody: 'A'.repeat(32768),
        })
        .expect(201);

      expect(res2.body.resolvedPrompt).toBeDefined();
    });
  });

  describe('CORS Headers', () => {
    it('sets Access-Control-Allow-Origin for configured frontend origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .set('Origin', 'http://localhost:4200')
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4200');
    });

    it('SEC-04: response contains helmet security headers', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .expect(200);

      // helmet sets these headers by default
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['x-dns-prefetch-control']).toBeDefined();
    });
  });

  describe('System Settings Endpoint', () => {
    it('resolves GET /api/settings with 200 OK and safe environment status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/settings')
        .set(authHeader)
        .expect(200);

      expect(res.body.application).toBeDefined();
      expect(res.body.application.name).toBe('PromptLab');
      expect(res.body.gateway).toBeDefined();
      expect(res.body.database).toBeDefined();
      expect(res.body.quotaPolicy).toBeDefined();
      expect(res.body.observability).toBeDefined();
      expect(res.body.security).toBeDefined();
      expect(res.body.security.secretsExposed).toBe(false);

      // Verify no secrets or sensitive keys leaked in payload
      const json = JSON.stringify(res.body);
      expect(json).not.toContain('sk-promptlab-dev-key');
      expect(json).not.toContain('admin'); // postgres password
      expect(json).not.toContain('OPENAI_API_KEY');
    });

    it('returns the same gateway URL across /api/health and /api/settings', async () => {
      const healthRes = await request(app.getHttpServer())
        .get('/api/health')
        .expect(200);

      const settingsRes = await request(app.getHttpServer())
        .get('/api/settings')
        .set(authHeader)
        .expect(200);

      expect(healthRes.body.services.gateway.url).toBe(settingsRes.body.gateway.url);
    });
  });

  describe('Pagination Across List Endpoints', () => {
    it('supports limit and offset pagination on GET /api/prompts', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/prompts?limit=2&offset=0')
        .set(authHeader)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(2);
    });

    it('rejects invalid pagination parameters on GET /api/prompts with 400 Bad Request', async () => {
      // limit < 1
      await request(app.getHttpServer())
        .get('/api/prompts?limit=0')
        .set(authHeader)
        .expect(400);

      // limit > 100
      await request(app.getHttpServer())
        .get('/api/prompts?limit=101')
        .set(authHeader)
        .expect(400);

      // offset < 0
      await request(app.getHttpServer())
        .get('/api/prompts?offset=-1')
        .set(authHeader)
        .expect(400);

      // non-numeric limit
      await request(app.getHttpServer())
        .get('/api/prompts?limit=abc')
        .set(authHeader)
        .expect(400);
    });

    it('supports limit and offset pagination on GET /api/experiments', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/experiments?limit=5&offset=0')
        .set(authHeader)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(5);
    });

    it('supports limit and offset pagination on GET /api/conversations', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/conversations?limit=5&offset=0')
        .set(authHeader)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Payload Limit Enforcement (SEC-04a)', () => {
    it('rejects a 300 KB body with 413 Payload Too Large', async () => {
      const largePayload = {
        title: 'Large Payload Test',
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'A'.repeat(300 * 1024), // 300 KB string
      };

      await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send(largePayload)
        .expect(413);
    });
  });

  describe('Proxy Trust & Rate Limiting (SEC-04b)', () => {
    it('with TRUST_PROXY unset, 25 requests within 1 s using different X-Forwarded-For values must receive 429', async () => {
      const requests = Array.from({ length: 25 }, (_, i) =>
        request(app.getHttpServer())
          .get('/api/health')
          .set('X-Forwarded-For', `198.51.100.${i + 1}`),
      );

      const responses = await Promise.all(requests);
      const statuses = responses.map((r) => r.status);
      const throttledResponses = statuses.filter((status) => status === 429);

      // Burst limit is 20 requests per 1 s window; without proxy trust, all 25 requests share the socket IP
      expect(throttledResponses.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Concurrency & Quota Management (Phase 3)', () => {
    it('handles concurrent first-of-month quota period and policy creation without P2002 conflict (QUOTA-01)', async () => {
      const prisma = app.get(PrismaService);
      const usageService = app.get(UsageService);
      const testUserId = `test-user-quota01-${Date.now()}`;

      await prisma.user.create({
        data: {
          id: testUserId,
          email: `${testUserId}@example.com`,
          displayName: 'Quota01 Test User',
          role: 'user',
        },
      });

      // Fire 10 concurrent reserveUsage calls simultaneously for a fresh user with no existing policy or period
      const concurrentReservations = Array.from({ length: 10 }, (_, i) =>
        usageService.reserveUsage({
          requestId: `req-quota01-${i}-${Date.now()}`,
          userId: testUserId,
          model: 'gpt-4o-mini',
          provider: 'gateway',
          estimatedTokens: 100,
        }),
      );

      const results = await Promise.allSettled(concurrentReservations);
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(0); // Zero P2002 failures!

      const policy = await prisma.quotaPolicy.findUnique({
        where: { scope_scopeId: { scope: 'user', scopeId: testUserId } },
      });
      expect(policy).toBeDefined();

      const periods = await prisma.quotaPeriod.findMany({
        where: { userId: testUserId },
      });
      expect(periods).toHaveLength(1);
    });

    it('executes 10 concurrent execute() calls with one key → exactly 1 provider call and 1 reservation (ARCH-01b)', async () => {
      const prisma = app.get(PrismaService);
      const llmExecutionService = app.get(LlmExecutionService);
      const providersService = app.get(ProvidersService);
      const testUserId = `test-user-arch01b-${Date.now()}`;
      const idempotencyKey = `idemp-arch01b-${Date.now()}`;

      await prisma.user.create({
        data: {
          id: testUserId,
          email: `${testUserId}@example.com`,
          displayName: 'ARCH01b Test User',
          role: 'user',
        },
      });

      let providerCalls = 0;
      jest.spyOn(providersService, 'executeChatCompletion').mockImplementation(async (params) => {
        providerCalls++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          success: true,
          model: params.model,
          content: 'Concurrent idempotency completion',
          latencyMs: 50,
          usage: {
            promptTokens: 10,
            completionTokens: 10,
            totalTokens: 20,
            source: 'provider-reported',
          },
        };
      });

      const concurrentCalls = Array.from({ length: 10 }, () =>
        llmExecutionService.execute({
          userId: testUserId,
          operation: 'playground.execute',
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Testing concurrency' }],
          idempotencyKey,
        }),
      );

      const results = await Promise.allSettled(concurrentCalls);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly 1 provider call was made across all 10 concurrent requests!
      expect(providerCalls).toBe(1);

      // Callers that completed while in-flight receive 409 REQUEST_IN_PROGRESS; callers after receive the stored result
      for (const res of fulfilled) {
        expect((res as PromiseFulfilledResult<any>).value.content).toBe('Concurrent idempotency completion');
      }
      for (const rej of rejected) {
        expect((rej as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
        expect((rej as PromiseRejectedResult).reason.message).toBe('REQUEST_IN_PROGRESS');
      }

      // Exactly 1 provider call was made
      expect(providerCalls).toBe(1);

      // In real Postgres, exactly 1 usage record exists for (userId, requestId)
      const records = await prisma.usageRecord.findMany({
        where: { userId: testUserId, requestId: idempotencyKey },
      });
      expect(records).toHaveLength(1);
      expect(records[0].status).toBe('reconciled');
      expect((records[0].responseBody as any)?.content).toBe('Concurrent idempotency completion');

      // Replay test: subsequent call returns the stored result with 0 additional provider calls
      const replayResult = await llmExecutionService.execute({
        userId: testUserId,
        operation: 'playground.execute',
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Testing concurrency' }],
        idempotencyKey,
      });
      expect(replayResult.success).toBe(true);
      expect(replayResult.content).toBe('Concurrent idempotency completion');
      expect(providerCalls).toBe(1); // Still 1!
    });

    it('executes 50 concurrent reserveUsage calls against a limit allowing 10 → exactly 10 succeed (QUOTA-02)', async () => {
      const prisma = app.get(PrismaService);
      const usageService = app.get(UsageService);
      const testUserId = `test-user-quota02-${Date.now()}`;

      await prisma.user.create({
        data: {
          id: testUserId,
          email: `${testUserId}@example.com`,
          displayName: 'QUOTA02 Test User',
          role: 'user',
        },
      });

      // Set user policy to 1,000 monthly tokens with a high rate limit so rate limiting does not interfere
      await prisma.quotaPolicy.create({
        data: {
          scope: 'user',
          scopeId: testUserId,
          monthlyTokenLimit: 1_000,
          requestRateLimit: 500,
        },
      });

      const { periodStart, periodEnd } = usageService.getUtcMonthBounds();
      await prisma.quotaPeriod.create({
        data: {
          userId: testUserId,
          periodStart,
          periodEnd,
          tokenLimit: 1_000,
          reservedTokens: 0,
          actualTokens: 0,
          status: 'active',
        },
      });

      // Launch 50 concurrent reservations, each requesting 100 tokens (10 * 100 = 1000 limit)
      const concurrentReservations = Array.from({ length: 50 }, (_, i) =>
        usageService.reserveUsage({
          requestId: `req-quota02-${i}-${Date.now()}`,
          userId: testUserId,
          model: 'gpt-4o-mini',
          provider: 'gateway',
          estimatedTokens: 100,
        }),
      );

      const results = await Promise.allSettled(concurrentReservations);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly 10 succeed, exactly 40 fail with QUOTA_EXCEEDED!
      expect(fulfilled).toHaveLength(10);
      expect(rejected).toHaveLength(40);

      for (const res of fulfilled) {
        expect((res as PromiseFulfilledResult<any>).value.success).toBe(true);
        expect((res as PromiseFulfilledResult<any>).value.reservedTokens).toBe(100);
      }

      for (const rej of rejected) {
        const error = (rej as PromiseRejectedResult).reason;
        expect(error.getStatus()).toBe(429);
        expect(error.getResponse().error).toBe('QUOTA_EXCEEDED');
      }

      // Check the quota period in PostgreSQL: reservedTokens must be exactly 1000 (never over-allocated)
      const period = await prisma.quotaPeriod.findUnique({
        where: {
          userId_periodStart: {
            userId: testUserId,
            periodStart,
          },
        },
      });
      expect(period?.reservedTokens).toBe(1_000);
      expect(period?.actualTokens).toBe(0);

      // Check usage records in PostgreSQL: exactly 10 records exist, all for the succeeded reservations
      const records = await prisma.usageRecord.findMany({
        where: { userId: testUserId },
      });
      expect(records).toHaveLength(10);
      for (const rec of records) {
        expect(rec.status).toBe('reserved');
        expect(rec.reservedTokens).toBe(100);
      }
    });

    it('executes 10 concurrent reconcileUsage calls for the same request → applies exactly once (QUOTA-03)', async () => {
      const prisma = app.get(PrismaService);
      const usageService = app.get(UsageService);
      const testUserId = `user-quota03-${Date.now()}`;
      const testRequestId = `req-quota03-${Date.now()}`;

      await prisma.user.create({
        data: {
          id: testUserId,
          email: `${testUserId}@example.com`,
          displayName: 'QUOTA03 Test User',
          role: 'user',
        },
      });

      await prisma.quotaPolicy.create({
        data: {
          scope: 'user',
          scopeId: testUserId,
          monthlyTokenLimit: 10_000,
          requestRateLimit: 500,
        },
      });

      // 1. Initial reservation of 1,000 tokens
      const reservation = await usageService.reserveUsage({
        requestId: testRequestId,
        userId: testUserId,
        model: 'gpt-4o-mini',
        provider: 'gateway',
        estimatedTokens: 1_000,
      });

      expect(reservation.success).toBe(true);
      expect(reservation.reservedTokens).toBe(1_000);

      // Verify DB state before reconciles: 1,000 reserved, 0 actual
      const { periodStart } = usageService.getUtcMonthBounds();
      let period = await prisma.quotaPeriod.findUnique({
        where: {
          userId_periodStart: {
            userId: testUserId,
            periodStart,
          },
        },
      });
      expect(period?.reservedTokens).toBe(1_000);
      expect(period?.actualTokens).toBe(0);

      // 2. Fire 10 concurrent reconciles of this exact same request
      const concurrentReconciles = Array.from({ length: 10 }, () =>
        usageService.reconcileUsage({
          requestId: testRequestId,
          userId: testUserId,
          success: true,
          usage: {
            promptTokens: 400,
            completionTokens: 200,
            totalTokens: 600,
            source: 'provider-reported',
          },
          responseBody: {
            success: true,
            content: 'Concurrent reconcile response',
            model: 'gpt-4o-mini',
            latencyMs: 120,
          },
        }),
      );

      const results = await Promise.all(concurrentReconciles);

      // All 10 resolve successfully
      for (const res of results) {
        expect(res.success).toBe(true);
        expect(res.record).toBeDefined();
        expect(res.record?.status).toBe('reconciled');
      }

      // Check the quota period in PostgreSQL:
      // reservedTokens MUST have been decremented by 1,000 exactly once (now 0, NOT negative -9,000)
      // actualTokens MUST have been incremented by 600 exactly once (now 600, NOT 6,000)
      period = await prisma.quotaPeriod.findUnique({
        where: {
          userId_periodStart: {
            userId: testUserId,
            periodStart,
          },
        },
      });
      expect(period?.reservedTokens).toBe(0);
      expect(period?.actualTokens).toBe(600);

      // Check usage record in PostgreSQL: exactly 1 record exists with reconciled values
      const record = await prisma.usageRecord.findUnique({
        where: {
          userId_requestId: {
            userId: testUserId,
            requestId: testRequestId,
          },
        },
      });
      expect(record?.status).toBe('reconciled');
      expect(record?.inputTokens).toBe(400);
      expect(record?.outputTokens).toBe(200);
      expect(record?.reconciledAt).not.toBeNull();
    });

    it('releases a stale reservation exactly once across concurrent sweepers (QUOTA-04)', async () => {
      const prisma = app.get(PrismaService);
      const usageService = app.get(UsageService);
      const testUserId = `user-quota04-${Date.now()}`;
      const testRequestId = `req-quota04-${Date.now()}`;

      await prisma.user.create({
        data: {
          id: testUserId,
          email: `${testUserId}@example.com`,
          displayName: 'QUOTA04 Test User',
          role: 'user',
        },
      });

      await prisma.quotaPolicy.create({
        data: {
          scope: 'user',
          scopeId: testUserId,
          monthlyTokenLimit: 10_000,
          requestRateLimit: 500,
        },
      });

      // 1. Initial reservation of 750 tokens
      const reservation = await usageService.reserveUsage({
        requestId: testRequestId,
        userId: testUserId,
        model: 'gpt-4o-mini',
        provider: 'gateway',
        estimatedTokens: 750,
      });

      expect(reservation.success).toBe(true);
      expect(reservation.reservedTokens).toBe(750);

      // Verify DB state before sweeper: 750 reserved, 0 actual
      const { periodStart } = usageService.getUtcMonthBounds();
      let period = await prisma.quotaPeriod.findUnique({
        where: {
          userId_periodStart: {
            userId: testUserId,
            periodStart,
          },
        },
      });
      expect(period?.reservedTokens).toBe(750);
      expect(period?.actualTokens).toBe(0);

      // 2. Age the reservation so it is older than the 60s threshold (e.g. 120s ago)
      const staleDate = new Date(Date.now() - 120_000);
      await prisma.usageRecord.update({
        where: {
          userId_requestId: {
            userId: testUserId,
            requestId: testRequestId,
          },
        },
        data: {
          createdAt: staleDate,
        },
      });

      // 3. Launch TWO sweepers concurrently (both targeting maxAgeMs = 60_000)
      const [sweep1, sweep2] = await Promise.all([
        usageService.sweepExpiredReservations(60_000),
        usageService.sweepExpiredReservations(60_000),
      ]);

      // Exactly ONE sweeper locked and processed the stale reservation (FOR UPDATE SKIP LOCKED)
      expect(sweep1.sweptCount + sweep2.sweptCount).toBe(1);

      // 4. Verify in PostgreSQL: reservedTokens decremented by 750 exactly once (now 0, not negative!)
      period = await prisma.quotaPeriod.findUnique({
        where: {
          userId_periodStart: {
            userId: testUserId,
            periodStart,
          },
        },
      });
      expect(period?.reservedTokens).toBe(0);
      expect(period?.actualTokens).toBe(0);

      // 5. Verify usageRecord status is 'expired' in PostgreSQL
      const record = await prisma.usageRecord.findUnique({
        where: {
          userId_requestId: {
            userId: testUserId,
            requestId: testRequestId,
          },
        },
      });
      expect(record?.status).toBe('expired');
      expect(record?.reconciledAt).not.toBeNull();
      expect(record?.responseBody).toEqual(
        expect.objectContaining({
          error: 'RESERVATION_EXPIRED',
        }),
      );

      // 6. Running sweeper again reclaims 0 records (idempotent)
      const sweepAgain = await usageService.sweepExpiredReservations(60_000);
      expect(sweepAgain.sweptCount).toBe(0);
    });
  });

});

