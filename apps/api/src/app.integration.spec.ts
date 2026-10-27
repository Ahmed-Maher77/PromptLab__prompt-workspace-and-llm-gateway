import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ConflictException } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import * as request from 'supertest';
import { AppModule } from './app.module';
import { validateEnvironment } from './common/config/env.validation';
import { configureApp } from './configure-app';
import { PrismaService } from './prisma/prisma.service';
import { PrismaClient, Prisma } from '@prisma/client';
import { UsageService } from './usage/usage.service';
import { LlmExecutionService } from './llm/llm-execution.service';
import { ProvidersService } from './providers/providers.service';
import { ModelCatalogService } from './providers/model-catalog.service';
import { APP_CONFIG } from './common/config/env.validation';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Rate-limit counters are in-memory and keyed by route + client IP, so hits from one test
 * would otherwise count against the next (timing-dependent: fast CI runners trip the 20/s
 * burst limit, slower machines don't). This delegating storage lets each test start from a
 * fresh ThrottlerStorageService while still exercising the real ThrottlerGuard and limits.
 */
class ResettableThrottlerStorage implements ThrottlerStorage {
  private inner = new ThrottlerStorageService();

  increment(...args: Parameters<ThrottlerStorage['increment']>) {
    return this.inner.increment(...args);
  }

  reset(): void {
    this.inner.onApplicationShutdown();
    this.inner = new ThrottlerStorageService();
  }
}

describe('HTTP Routing & App Integration (E2E)', () => {
  let app: INestApplication;
  const authHeader = { Authorization: 'Bearer dev-admin-token' };
  const origEnv = process.env;
  jest.setTimeout(30000);
  const throttlerStorage = new ResettableThrottlerStorage();

  afterEach(() => {
    throttlerStorage.reset();
  });

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
    })
      .overrideProvider(ThrottlerStorage)
      .useValue(throttlerStorage)
      .compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });

    // Use the shared configureApp() so the test exercises the real production pipeline
    configureApp(app, envConfig);

    await app.init();
  }, 30000);

  afterAll(async () => {
    throttlerStorage.reset();
    process.env = origEnv;
    if (app) {
      await app.close();
    }
  });

  describe('Authentication & Authorization Guards', () => {
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

    it('allows a non-admin user to create a conversation after automatic User upsert', async () => {
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
      expect(res.body.services.database.status).toBeDefined();
      expect(res.body.services.gateway.serviceAvailability).toBeDefined();
      expect(res.body.services.gateway.url).toBeUndefined();
      expect(res.body.services.gateway.providerReadiness).toBeUndefined();
      expect(res.body.environment).toBeUndefined();
    });

    it('returns the full GET /api/health payload to an admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .set(authHeader)
        .expect(200);

      expect(res.body.services.gateway.url).toBeDefined();
      expect(res.body.environment).toBeDefined();
    });

    describe('liveness and readiness probes', () => {
      const realFetch = global.fetch;

      afterEach(() => {
        global.fetch = realFetch;
      });

      /** Routes only gateway-probe fetches to the stub; anything else keeps the real fetch. */
      const stubGateway = (up: boolean) => {
        global.fetch = jest.fn((input: any, init?: any) => {
          const url = typeof input === 'string' ? input : input?.url ?? '';
          if (/\/health(\/liveliness)?$/.test(url)) {
            return up
              ? Promise.resolve(new Response('ok', { status: 200 }))
              : Promise.reject(new TypeError('fetch failed'));
          }
          return realFetch(input, init);
        }) as typeof fetch;
      };

      it('GET /api/health/live answers 200 without credentials or dependency checks', async () => {
        stubGateway(false);
        const res = await request(app.getHttpServer()).get('/api/health/live').expect(200);
        expect(res.body.status).toBe('ok');
        expect(global.fetch).not.toHaveBeenCalled();
      });

      it('GET /api/health/ready answers 503 with the failing dependency when the gateway is down', async () => {
        stubGateway(false);
        const res = await request(app.getHttpServer()).get('/api/health/ready').expect(503);
        expect(res.body.status).toBe(503);
        expect(res.body.error).toMatchObject({ gateway: { status: 'down' } });
        expect(res.body.info).toMatchObject({ database: { status: 'up' } });
      });

      it('GET /api/health/ready answers 200 when the database and gateway are up', async () => {
        stubGateway(true);
        const res = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.info).toMatchObject({ database: { status: 'up' }, gateway: { status: 'up' } });
      });

      it('GET /api/health keeps answering 200 for the UI even when the gateway is down', async () => {
        stubGateway(false);
        const res = await request(app.getHttpServer()).get('/api/health').expect(200);
        expect(res.body.services.gateway.serviceAvailability).toBe('unreachable');
      });
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

    it('response contains helmet security headers', async () => {
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
        .set(authHeader)
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

    it('filters GET /api/prompts by technique in the database and paginates the filtered set', async () => {
      const tag = `tech-filter-${Date.now()}`;
      const create = (name: string, techniques: string[]) =>
        request(app.getHttpServer())
          .post('/api/prompts')
          .set(authHeader)
          .send({ name, techniques, templateBody: `Say {{word}} (${tag})` })
          .expect(201);

      await create(`${tag}-few-1`, ['few-shot', 'RTF']);
      await create(`${tag}-zero`, ['zero-shot']);
      await create(`${tag}-few-2`, ['few-shot']);

      const all = await request(app.getHttpServer())
        .get(`/api/prompts?technique=few-shot&search=${tag}`)
        .set(authHeader)
        .expect(200);
      expect(all.body.map((p: { name: string }) => p.name).sort()).toEqual(
        [`${tag}-few-1`, `${tag}-few-2`].sort(),
      );
      expect(all.body.every((p: { techniques: string[] }) => p.techniques.includes('few-shot'))).toBe(
        true,
      );
      expect(all.body[0].versionCount).toBe(1);

      const page = await request(app.getHttpServer())
        .get(`/api/prompts?technique=few-shot&search=${tag}&limit=1&offset=1`)
        .set(authHeader)
        .expect(200);
      expect(page.body).toHaveLength(1);
      expect(page.body[0].name).toBe(all.body[1].name);
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

  describe('Payload Limit Enforcement', () => {
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

  describe('Proxy Trust & Rate Limiting', () => {
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
    it('handles concurrent first-of-month quota period and policy creation without P2002 conflict', async () => {
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

    it('executes 10 concurrent execute() calls with one key → exactly 1 provider call and 1 reservation', async () => {
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

    it('executes 50 concurrent reserveUsage calls against a limit allowing 10 → exactly 10 succeed', async () => {
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

    it('executes 10 concurrent reconcileUsage calls for the same request → applies exactly once', async () => {
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

    it('releases a stale reservation exactly once across concurrent sweepers', async () => {
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

      // Clear any pre-existing stale reservations from previous aborted test runs
      await usageService.sweepExpiredReservations(0);

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

    it('stores UTC createdAt immune to session TimeZone and sweeps correctly under Asia/Baghdad', async () => {
      const appConfig = app.get(APP_CONFIG);
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set('options', '-c TimeZone=Asia/Baghdad');

      const tzPrisma = new PrismaClient({
        datasources: {
          db: {
            url: url.toString(),
          },
        },
      });

      try {
        // Assert SHOW TIME ZONE returns Asia/Baghdad through this dedicated client
        const tzRows = await tzPrisma.$queryRaw<Array<{ TimeZone: string }>>`SHOW TIME ZONE;`;
        expect(tzRows[0]?.TimeZone).toBe('Asia/Baghdad');

        const tzUsage = new UsageService(
          tzPrisma as unknown as PrismaService,
          appConfig,
          app.get(ModelCatalogService),
        );
        const testUserId = `user-time01-${Date.now()}`;
        const testRequestId = `req-time01-${Date.now()}`;

        await tzPrisma.user.create({
          data: {
            id: testUserId,
            email: `${testUserId}@example.com`,
            displayName: 'Time01 Test User',
            role: 'user',
          },
        });

        await tzPrisma.quotaPolicy.create({
          data: {
            scope: 'user',
            scopeId: testUserId,
            monthlyTokenLimit: 10_000,
            requestRateLimit: 500,
          },
        });

        // 1. Claim reservation using tzUsage (executes raw INSERT against Asia/Baghdad session)
        const reservation = await tzUsage.reserveUsage({
          requestId: testRequestId,
          userId: testUserId,
          model: 'gpt-4o-mini',
          provider: 'gateway',
          estimatedTokens: 300,
        });

        expect(reservation.success).toBe(true);
        expect(reservation.created).toBe(true);

        // 2. Query record from DB; assert createdAt matches new Date() within seconds (NOT ~3 hours ahead)
        const record = await tzPrisma.usageRecord.findUnique({
          where: {
            userId_requestId: {
              userId: testUserId,
              requestId: testRequestId,
            },
          },
        });

        expect(record).toBeDefined();
        const diffMs = Math.abs(new Date(record!.createdAt).getTime() - Date.now());
        expect(diffMs).toBeLessThan(5000);

        // 3. Age reservation past cutoff using UTC SQL interval
        await tzPrisma.$executeRaw`
          UPDATE "usage_records"
          SET "createdAt" = (NOW() AT TIME ZONE 'UTC') - INTERVAL '120 seconds'
          WHERE "id" = ${record!.id}
        `;

        // 4. Sweeper under Asia/Baghdad session correctly identifies and sweeps the stale record
        const sweepResult = await tzUsage.sweepExpiredReservations(60_000);
        expect(sweepResult.sweptCount).toBeGreaterThanOrEqual(1);

        const sweptRecord = await tzPrisma.usageRecord.findUnique({
          where: { id: record!.id },
        });
        expect(sweptRecord?.status).toBe('expired');
      } finally {
        await tzPrisma.$disconnect();
      }
    });
  });

  describe('Client Idempotency Keys and Deduping', () => {
    it('validates Idempotency-Key header against ^[A-Za-z0-9._:-]{8,128}$ (otherwise 400)', async () => {
      // 1. POST /api/prompts/run with invalid header
      await request(app.getHttpServer())
        .post('/api/prompts/run')
        .set(authHeader)
        .set('Idempotency-Key', 'short')
        .send({ templateBody: 'Hello', model: 'gpt-4o-mini' })
        .expect(400);

      // 2. POST /api/experiments/run with invalid characters (spaces)
      await request(app.getHttpServer())
        .post('/api/experiments/run')
        .set(authHeader)
        .set('Idempotency-Key', 'invalid key spaces')
        .send({
          name: 'Compare',
          commonInput: {},
          slotA: { provider: 'openai', model: 'gpt-4o-mini', templateBody: 'Hi' },
          slotB: { provider: 'openai', model: 'gpt-4o-mini', templateBody: 'Hello' },
        })
        .expect(400);

      // Create conversation to test messages and compact preview
      const convRes = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({ title: 'Idemp Test Conv', provider: 'openai', model: 'gpt-4o-mini' })
        .expect(201);
      const convId = convRes.body.id;

      // 3. POST /api/conversations/:id/messages with invalid header
      await request(app.getHttpServer())
        .post(`/api/conversations/${convId}/messages`)
        .set(authHeader)
        .set('Idempotency-Key', 'invalid@char!')
        .send({ content: 'Test message' })
        .expect(400);

      // 4. POST /api/conversations/:id/compact/preview with invalid header (>128 chars)
      await request(app.getHttpServer())
        .post(`/api/conversations/${convId}/compact/preview`)
        .set(authHeader)
        .set('Idempotency-Key', 'a'.repeat(129))
        .send({ compactThroughSequence: 1 })
        .expect(400);
    });

    it('derives slot keys ${key}:A and ${key}:B for comparisons on POST /api/experiments/run', async () => {
      const providersService = app.get(ProvidersService);
      const prisma = app.get(PrismaService);
      const idempKey = `exp-test-${Date.now()}`;

      jest.spyOn(providersService, 'executeChatCompletion').mockImplementation(async (params) => {
        return {
          success: true,
          model: params.model,
          content: `Comparison response for ${params.requestId}`,
          latencyMs: 40,
          usage: {
            promptTokens: 10,
            completionTokens: 10,
            totalTokens: 20,
            source: 'provider-reported',
          },
        };
      });

      const res = await request(app.getHttpServer())
        .post('/api/experiments/run')
        .set(authHeader)
        .set('Idempotency-Key', idempKey)
        .send({
          name: 'Slot Keys Experiment',
          commonInput: { test: 'val' },
          slotA: { provider: 'gateway', model: 'gpt-4o-mini', templateBody: 'Slot A {{test}}' },
          slotB: { provider: 'gateway', model: 'gpt-4o-mini', templateBody: 'Slot B {{test}}' },
        })
        .expect(201);

      expect(res.body.slotA.status).toBe('completed');
      expect(res.body.slotB.status).toBe('completed');

      // Assert slot keys were created in usage_records with :A and :B
      const recordA = await prisma.usageRecord.findFirst({
        where: { requestId: `${idempKey}:A` },
      });
      const recordB = await prisma.usageRecord.findFirst({
        where: { requestId: `${idempKey}:B` },
      });

      expect(recordA).toBeDefined();
      expect(recordA?.status).toBe('reconciled');
      expect(recordB).toBeDefined();
      expect(recordB?.status).toBe('reconciled');
    });

    it('same key sent twice → 1 provider call, 1 reservation, identical response, and no duplicate messages', async () => {
      const providersService = app.get(ProvidersService);
      const prisma = app.get(PrismaService);
      const idempKey = `conv-replay-${Date.now()}`;

      const convRes = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({ title: 'Replay Conv', provider: 'gateway', model: 'gpt-4o-mini' })
        .expect(201);
      const convId = convRes.body.id;

      let providerCalls = 0;
      jest.spyOn(providersService, 'executeChatCompletion').mockImplementation(async (params) => {
        providerCalls++;
        return {
          success: true,
          model: params.model,
          content: 'Deterministic assistant reply',
          latencyMs: 50,
          usage: {
            promptTokens: 15,
            completionTokens: 10,
            totalTokens: 25,
            source: 'provider-reported',
          },
        };
      });

      // First request
      const res1 = await request(app.getHttpServer())
        .post(`/api/conversations/${convId}/messages`)
        .set(authHeader)
        .set('Idempotency-Key', idempKey)
        .send({ content: 'Tell me a story' })
        .expect(201);

      expect(res1.body.success).toBe(true);
      expect(res1.body.userMessage.content).toBe('Tell me a story');
      expect(res1.body.assistantMessage.content).toBe('Deterministic assistant reply');

      // Second request with IDENTICAL Idempotency-Key
      const res2 = await request(app.getHttpServer())
        .post(`/api/conversations/${convId}/messages`)
        .set(authHeader)
        .set('Idempotency-Key', idempKey)
        .send({ content: 'Tell me a story' })
        .expect(201);

      // Identical response returned!
      expect(res2.body.success).toBe(true);
      expect(res2.body.userMessage.id).toBe(res1.body.userMessage.id);
      expect(res2.body.assistantMessage.id).toBe(res1.body.assistantMessage.id);
      expect(res2.body.assistantMessage.content).toBe(res1.body.assistantMessage.content);

      // Exactly 1 provider call made across both requests!
      expect(providerCalls).toBe(1);

      // Exactly 1 usage record exists for this idempotency key
      const usageRecords = await prisma.usageRecord.findMany({
        where: { requestId: idempKey },
      });
      expect(usageRecords).toHaveLength(1);
      expect(usageRecords[0].status).toBe('reconciled');

      // NO duplicate messages: DB has exactly 1 user message and 1 assistant message
      const messages = await prisma.conversationMessage.findMany({
        where: { conversationId: convId },
      });
      expect(messages).toHaveLength(2);
      expect(messages.filter((m) => m.role === 'user')).toHaveLength(1);
      expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    });

    it('same key while first is in flight → 409 REQUEST_IN_PROGRESS and no duplicate messages', async () => {
      const providersService = app.get(ProvidersService);
      const prisma = app.get(PrismaService);
      const idempKey = `conv-inflight-${Date.now()}`;

      const convRes = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({ title: 'In-Flight Conv', provider: 'gateway', model: 'gpt-4o-mini' })
        .expect(201);
      const convId = convRes.body.id;

      let unblockProvider: () => void;
      const providerGate = new Promise<void>((resolve) => {
        unblockProvider = resolve;
      });

      let signalStarted: () => void;
      const providerStarted = new Promise<void>((resolve) => {
        signalStarted = resolve;
      });

      let providerCalls = 0;
      jest.spyOn(providersService, 'executeChatCompletion').mockImplementation(async (params) => {
        providerCalls++;
        signalStarted();
        await providerGate;
        return {
          success: true,
          model: params.model,
          content: 'In-flight completion result',
          latencyMs: 100,
          usage: {
            promptTokens: 12,
            completionTokens: 8,
            totalTokens: 20,
            source: 'provider-reported',
          },
        };
      });

      // Send first request and kick it off with .then() so it starts executing
      const req1Execution = request(app.getHttpServer())
        .post(`/api/conversations/${convId}/messages`)
        .set(authHeader)
        .set('Idempotency-Key', idempKey)
        .send({ content: 'Concurrent message' })
        .then((res) => res);

      // Wait until req1 has established quota reservation and called provider
      await providerStarted;

      // Send second request with same key while req1 is in flight
      const res2 = await request(app.getHttpServer())
        .post(`/api/conversations/${convId}/messages`)
        .set(authHeader)
        .set('Idempotency-Key', idempKey)
        .send({ content: 'Concurrent message duplicate' })
        .expect(409);

      expect(res2.body.message).toBe('REQUEST_IN_PROGRESS');

      // Now unblock req1
      unblockProvider!();
      const res1 = await req1Execution;
      expect(res1.status).toBe(201);
      expect(res1.body.success).toBe(true);

      // Assert only 1 provider call was made
      expect(providerCalls).toBe(1);

      // Assert no duplicate messages in DB
      const messages = await prisma.conversationMessage.findMany({
        where: { conversationId: convId },
      });
      expect(messages).toHaveLength(2);
      expect(messages.filter((m) => m.role === 'user')).toHaveLength(1);
      expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    });

    it('fires the same key while persistence is paused after the provider call → 409 or correct turn, with exactly 2 messages in the end', async () => {
      const providersService = app.get(ProvidersService);
      const prisma = app.get(PrismaService);
      const idempKey = `conv-pause-${Date.now()}`;

      const convRes = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({ title: 'Pause Persistence Conv', provider: 'gateway', model: 'gpt-4o-mini' })
        .expect(201);
      const convId = convRes.body.id;

      jest.spyOn(providersService, 'executeChatCompletion').mockImplementation(async (params) => {
        return {
          success: true,
          model: params.model,
          content: 'Provider finished output',
          latencyMs: 30,
          usage: {
            promptTokens: 10,
            completionTokens: 10,
            totalTokens: 20,
            source: 'provider-reported',
          },
        };
      });

      let unblockPersistence: () => void;
      const persistenceGate = new Promise<void>((resolve) => {
        unblockPersistence = resolve;
      });

      let signalPersistenceReached: () => void;
      const persistenceReached = new Promise<void>((resolve) => {
        signalPersistenceReached = resolve;
      });

      // Spy on prisma.$transaction on the real PrismaService
      const originalTransaction = prisma.$transaction.bind(prisma);
      let paused = false;
      jest.spyOn(prisma, '$transaction').mockImplementation(async (arg: any) => {
        if (!paused) {
          paused = true;
          signalPersistenceReached();
          await persistenceGate;
        }
        return originalTransaction(arg);
      });

      try {
        // 1. Kick off req1
        const req1Promise = request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .set('Idempotency-Key', idempKey)
          .send({ content: 'Message while persistence paused' })
          .then((res) => res);

        // 2. Wait until req1 has finished provider call and entered the persistence window
        await persistenceReached;

        // 3. Fire req2 with the exact same key while req1 is paused in persistence
        const res2 = await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .set('Idempotency-Key', idempKey)
          .send({ content: 'Message while persistence paused' });

        // During persistence pause, messages are not yet committed to DB, so req2 must return 409 REQUEST_IN_PROGRESS
        expect([200, 201, 409]).toContain(res2.status);
        if (res2.status === 409) {
          expect(res2.body.message).toBe('REQUEST_IN_PROGRESS');
        } else {
          expect(res2.body.success).toBe(true);
        }

        // 4. Unblock req1's transaction
        unblockPersistence!();
        const res1 = await req1Promise;
        expect(res1.status).toBe(201);
        expect(res1.body.success).toBe(true);

        // 5. Subsequent replay returns the completed turn successfully
        const res3 = await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .set('Idempotency-Key', idempKey)
          .send({ content: 'Message while persistence paused' })
          .expect(201);
        expect(res3.body.success).toBe(true);
        expect(res3.body.userMessage.id).toBe(res1.body.userMessage.id);
        expect(res3.body.assistantMessage.id).toBe(res1.body.assistantMessage.id);

        // 6. DB check: exactly 2 messages in the end (1 user, 1 assistant)
        const messages = await prisma.conversationMessage.findMany({
          where: { conversationId: convId },
        });
        expect(messages).toHaveLength(2);
        expect(messages.filter((m) => m.role === 'user')).toHaveLength(1);
        expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('allocates sequence numbers atomically under parallel sends with different keys', async () => {
      const providersService = app.get(ProvidersService);
      const prisma = app.get(PrismaService);

      const convRes = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({
          title: 'Parallel Sequence Allocation Conv',
          provider: 'gateway',
          model: 'gpt-4o-mini',
          systemPrompt: 'You are an atomic assistant.',
        })
        .expect(201);
      const convId = convRes.body.id;

      jest.spyOn(providersService, 'executeChatCompletion').mockImplementation(async (params) => {
        // Small random delay (5-30ms) to interleave concurrent requests
        await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 25) + 5));
        return {
          success: true,
          model: params.model,
          content: 'Atomic response content',
          latencyMs: 25,
          usage: {
            promptTokens: 10,
            completionTokens: 10,
            totalTokens: 20,
            source: 'provider-reported',
          },
        };
      });

      try {
        const parallelCount = 6;
        const sendPromises = Array.from({ length: parallelCount }, (_, idx) => {
          const idempKey = `conv-par-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
          return request(app.getHttpServer())
            .post(`/api/conversations/${convId}/messages`)
            .set(authHeader)
            .set('Idempotency-Key', idempKey)
            .send({ content: `Parallel message ${idx}` });
        });

        const responses = await Promise.all(sendPromises);
        for (const res of responses) {
          expect(res.status).toBe(201);
          expect(res.body.success).toBe(true);
        }

        // Fetch all messages from Postgres ordered by sequenceNumber
        const allMessages = await prisma.conversationMessage.findMany({
          where: { conversationId: convId },
          orderBy: { sequenceNumber: 'asc' },
        });

        // System prompt (seq 1) + 6 pairs of (user, assistant) = 13 messages total
        const expectedTotal = 1 + parallelCount * 2;
        expect(allMessages.length).toBe(expectedTotal);

        const seqNumbers = allMessages.map((m) => m.sequenceNumber);
        const expectedSeq = Array.from({ length: expectedTotal }, (_, i) => i + 1);

        // Verify strictly continuous sequence numbers: no duplicates, no gaps!
        expect(seqNumbers).toEqual(expectedSeq);

        // Verify conversation lastSequence in database matches highest allocated sequence
        const convRecord = await prisma.conversation.findUnique({
          where: { id: convId },
        });
        expect(convRecord?.lastSequence).toBe(expectedTotal);
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('de-duplicates existing duplicate sequence rows during the sequence-uniqueness migration', async () => {
      const prisma = app.get(PrismaService);

      // Create a test conversation directly in DB
      const conv = await prisma.conversation.create({
        data: {
          ownerId: 'dev-user-001',
          title: 'Pre-migration Duplicates Conv',
          provider: 'gateway',
          model: 'gpt-4o-mini',
          status: 'active',
          lastSequence: 0,
        },
      });

      // Temporarily drop the unique index to simulate a pre-migration database state
      await prisma.$executeRawUnsafe(
        'DROP INDEX IF EXISTS "conversation_messages_conversationId_sequenceNumber_key";',
      );
      await prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS "conversation_messages_conversationId_sequenceNumber_idx" ON "conversation_messages"("conversationId", "sequenceNumber");',
      );

      try {
        // Seed duplicate sequence rows:
        // m1 at seq 1
        // m2, m3 at seq 2 (duplicate)
        // m4, m5 at seq 3 (duplicate)
        const t0 = new Date('2026-01-01T10:00:00Z');
        const t1 = new Date('2026-01-01T10:01:00Z');
        const t2 = new Date('2026-01-01T10:02:00Z');
        const t3 = new Date('2026-01-01T10:03:00Z');
        const t4 = new Date('2026-01-01T10:04:00Z');

        const prefix = `msg-dedup-${Date.now()}`;
        await prisma.$executeRawUnsafe(`
          INSERT INTO "conversation_messages" ("id", "conversationId", "role", "content", "sequenceNumber", "createdAt")
          VALUES
            ('${prefix}-1', '${conv.id}', 'system', 'sys', 1, '${t0.toISOString()}'),
            ('${prefix}-2', '${conv.id}', 'user', 'q1', 2, '${t1.toISOString()}'),
            ('${prefix}-3', '${conv.id}', 'assistant', 'a1', 2, '${t2.toISOString()}'),
            ('${prefix}-4', '${conv.id}', 'user', 'q2', 3, '${t3.toISOString()}'),
            ('${prefix}-5', '${conv.id}', 'assistant', 'a2', 3, '${t4.toISOString()}');
        `);

        // Read and apply the exact migration SQL file
        const migrationPath = path.resolve(
          __dirname,
          '../prisma/migrations/20261025210000_conv_01_conversation_sequence_uniqueness/migration.sql',
        );
        const migrationSql = fs.readFileSync(migrationPath, 'utf8');

        // Split statements by semicolon and execute each statement in order
        const statements = migrationSql
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const stmt of statements) {
          await prisma.$executeRawUnsafe(stmt);
        }

        // Fetch messages for this conversation ordered by sequenceNumber
        const messages = await prisma.conversationMessage.findMany({
          where: { conversationId: conv.id },
          orderBy: { sequenceNumber: 'asc' },
        });

        expect(messages).toHaveLength(5);
        const seqs = messages.map((m) => m.sequenceNumber);
        // Sequence numbers must be strictly unique and contiguous [1, 2, 3, 4, 5]
        expect(seqs).toEqual([1, 2, 3, 4, 5]);

        // lastSequence on conversation must equal MAX(sequenceNumber) = 5
        const updatedConv = await prisma.conversation.findUnique({
          where: { id: conv.id },
        });
        expect(updatedConv?.lastSequence).toBe(5);

        // Verify that inserting a duplicate sequence row now fails (unique constraint enforced)
        await expect(
          prisma.$executeRawUnsafe(`
            INSERT INTO "conversation_messages" ("id", "conversationId", "role", "content", "sequenceNumber", "createdAt")
            VALUES ('${prefix}-fail', '${conv.id}', 'user', 'fail', 1, NOW());
          `),
        ).rejects.toThrow();
      } finally {
        // Clean up test conversation and messages
        await prisma.conversation.deleteMany({
          where: { id: conv.id },
        });
        // Ensure index is restored in case of any failure
        await prisma.$executeRawUnsafe(
          'CREATE UNIQUE INDEX IF NOT EXISTS "conversation_messages_conversationId_sequenceNumber_key" ON "conversation_messages"("conversationId", "sequenceNumber");',
        );
      }
    });

    it('persists a failed turn with status failed and excludes it from context on subsequent turns', async () => {
      const providersService = app.get(ProvidersService);
      const prisma = app.get(PrismaService);

      // 1. Create a conversation
      const convRes = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({
          title: 'Failed Turn Context Exclusion Conv',
          provider: 'gateway',
          model: 'gpt-4o-mini',
          systemPrompt: 'System instruction.',
        })
        .expect(201);

      const convId = convRes.body.id;

      try {
        // 2. Mock provider to fail on turn 1
        const executeSpy = jest.spyOn(providersService, 'executeChatCompletion');
        executeSpy.mockResolvedValueOnce({
          success: false,
          errorMessage: 'Simulated provider rate limit',
          errorType: 'provider_quota_error',
          model: 'gpt-4o-mini',
          latencyMs: 80,
        });

        const failedKey = `failed-key-${Date.now()}`;
        const failRes = await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .set('Idempotency-Key', failedKey)
          .send({ content: 'Prompt that will fail upstream' })
          .expect(201); // 201 with success: false in payload

        expect(failRes.body.success).toBe(false);
        expect(failRes.body.errorMessage).toBe('Simulated provider rate limit');
        expect(failRes.body.userMessage).toBeDefined();
        expect(failRes.body.userMessage.status).toBe('failed');

        // Verify in DB that the user message is saved with status: 'failed'
        const dbFailedMsg = await prisma.conversationMessage.findUnique({
          where: { id: failRes.body.userMessage.id },
        });
        expect(dbFailedMsg?.status).toBe('failed');

        // 3. Turn 2: Mock provider to succeed, and assert the messages payload sent to provider does NOT include the failed message
        executeSpy.mockImplementationOnce(async (params) => {
          // Assert: messages sent to LLM should contain system instruction and current turn, but NOT the failed turn
          const messages = params.messages;
          const failedTurnInContext = messages.some((m: any) => m.content === 'Prompt that will fail upstream');
          expect(failedTurnInContext).toBe(false);
          return {
            success: true,
            content: 'I did not see your failed prompt, but I can answer this!',
            model: 'gpt-4o-mini',
            latencyMs: 120,
            usage: { promptTokens: 25, completionTokens: 15, totalTokens: 40, source: 'provider-reported' },
          };
        });

        const successKey = `success-key-${Date.now()}`;
        const turn2Res = await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .set('Idempotency-Key', successKey)
          .send({ content: 'Prompt that succeeds' })
          .expect(201);

        expect(turn2Res.body.success).toBe(true);

        // 4. Verify inspectContext also excludes the failed message
        const contextRes = await request(app.getHttpServer())
          .get(`/api/conversations/${convId}/context`)
          .set(authHeader)
          .expect(200);

        const assembledContents = contextRes.body.assembledMessages.map((m: any) => m.content);
        expect(assembledContents).not.toContain('Prompt that will fail upstream');
        expect(assembledContents).toContain('Prompt that succeeds');
      } finally {
        jest.restoreAllMocks();
        await prisma.conversation.deleteMany({ where: { id: convId } });
      }
    });

    it('returns 409 IDEMPOTENCY_RESULT_UNAVAILABLE when replayed key is reconciled but turn messages are missing past grace period', async () => {
      const providersService = app.get(ProvidersService);
      const prisma = app.get(PrismaService);

      // 1. Create a conversation
      const convRes = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({
          title: 'Stale Reconciled Replay Conv',
          provider: 'gateway',
          model: 'gpt-4o-mini',
        })
        .expect(201);

      const convId = convRes.body.id;
      const replayKey = `stale-replay-key-${Date.now()}`;

      try {
        // 2. Perform a successful turn
        jest.spyOn(providersService, 'executeChatCompletion').mockResolvedValueOnce({
          success: true,
          content: 'Original completion',
          model: 'gpt-4o-mini',
          latencyMs: 90,
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, source: 'provider-reported' },
        });

        const origRes = await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .set('Idempotency-Key', replayKey)
          .send({ content: 'Original message' })
          .expect(201);

        expect(origRes.body.success).toBe(true);

        // 3. Simulate missing turn messages in DB (e.g. server crashed before message commit)
        await prisma.conversationMessage.deleteMany({
          where: { requestId: replayKey },
        });

        // 4. Case A: Replay within 30s grace period -> returns 409 REQUEST_IN_PROGRESS
        const freshReplayRes = await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .set('Idempotency-Key', replayKey)
          .send({ content: 'Original message' })
          .expect(409);

        expect(freshReplayRes.body.message).toBe('REQUEST_IN_PROGRESS');

        // 5. Case B: Stale reconciled record (> 30s grace period)
        await prisma.usageRecord.updateMany({
          where: { requestId: replayKey },
          data: {
            reconciledAt: new Date(Date.now() - 35_000), // 35 seconds ago
          },
        });

        const staleReplayRes = await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .set('Idempotency-Key', replayKey)
          .send({ content: 'Original message' })
          .expect(409);

        expect(staleReplayRes.body.message).toBe('IDEMPOTENCY_RESULT_UNAVAILABLE');
        expect(staleReplayRes.body.code).toBe('IDEMPOTENCY_RESULT_UNAVAILABLE');
      } finally {
        jest.restoreAllMocks();
        await prisma.conversation.deleteMany({ where: { id: convId } });
      }
    });

    it('emits explicit code in 409 responses for in-flight, unavailable, and reused keys across endpoints', async () => {
      const prisma = app.get(PrismaService);
      const userId = 'dev-user-001';

      // Ensure user exists in DB
      await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: { id: userId, email: 'dev@promptlab.local', displayName: 'Developer Admin', role: 'admin' },
      });

      // 1. Seed 'reserved' usage record -> POST /api/prompts/run returns 409 with code REQUEST_IN_PROGRESS
      const inFlightKeyPrompt = `inflight-prompt-${Date.now()}`;
      await prisma.usageRecord.create({
        data: {
          requestId: inFlightKeyPrompt,
          userId,
          provider: 'gateway',
          model: 'gpt-4o-mini',
          status: 'reserved',
        },
      });

      const promptRes = await request(app.getHttpServer())
        .post('/api/prompts/run')
        .set(authHeader)
        .set('Idempotency-Key', inFlightKeyPrompt)
        .send({
          templateBody: 'Test template body',
          model: 'gpt-4o-mini',
        })
        .expect(409);

      expect(promptRes.body.status).toBe(409);
      expect(promptRes.body.code).toBe('REQUEST_IN_PROGRESS');
      expect(promptRes.body.message).toBe('REQUEST_IN_PROGRESS');

      // 2. Seed 'reserved' usage record -> POST /api/conversations/:id/messages returns 409 with code REQUEST_IN_PROGRESS
      const convRes = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({ title: 'Quota-05d Conv', provider: 'gateway', model: 'gpt-4o-mini' })
        .expect(201);
      const convId = convRes.body.id;

      const inFlightKeyConv = `inflight-conv-${Date.now()}`;
      await prisma.usageRecord.create({
        data: {
          requestId: inFlightKeyConv,
          userId,
          conversationId: convId,
          provider: 'gateway',
          model: 'gpt-4o-mini',
          status: 'reserved',
        },
      });

      const convMsgRes = await request(app.getHttpServer())
        .post(`/api/conversations/${convId}/messages`)
        .set(authHeader)
        .set('Idempotency-Key', inFlightKeyConv)
        .send({ content: 'In flight turn message' })
        .expect(409);

      expect(convMsgRes.body.status).toBe(409);
      expect(convMsgRes.body.code).toBe('REQUEST_IN_PROGRESS');
      expect(convMsgRes.body.message).toBe('REQUEST_IN_PROGRESS');

      // 3. Seed 'reconciled' record without responseBody -> 409 IDEMPOTENCY_RESULT_UNAVAILABLE with explicit code
      const unavailKey = `unavail-key-${Date.now()}`;
      await prisma.usageRecord.create({
        data: {
          requestId: unavailKey,
          userId,
          provider: 'gateway',
          model: 'gpt-4o-mini',
          status: 'reconciled',
          responseBody: Prisma.DbNull,
          reconciledAt: new Date(),
        },
      });

      const unavailRes = await request(app.getHttpServer())
        .post('/api/prompts/run')
        .set(authHeader)
        .set('Idempotency-Key', unavailKey)
        .send({
          templateBody: 'Test template body',
          model: 'gpt-4o-mini',
        })
        .expect(409);

      expect(unavailRes.body.status).toBe(409);
      expect(unavailRes.body.code).toBe('IDEMPOTENCY_RESULT_UNAVAILABLE');
      expect(unavailRes.body.message).toBe('IDEMPOTENCY_RESULT_UNAVAILABLE');

      // 4. Seed 'failed' record -> 409 IDEMPOTENCY_KEY_REUSED with explicit code
      const reusedKey = `reused-key-${Date.now()}`;
      await prisma.usageRecord.create({
        data: {
          requestId: reusedKey,
          userId,
          provider: 'gateway',
          model: 'gpt-4o-mini',
          status: 'failed',
        },
      });

      const reusedRes = await request(app.getHttpServer())
        .post('/api/prompts/run')
        .set(authHeader)
        .set('Idempotency-Key', reusedKey)
        .send({
          templateBody: 'Test template body',
          model: 'gpt-4o-mini',
        })
        .expect(409);

      expect(reusedRes.body.status).toBe(409);
      expect(reusedRes.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(reusedRes.body.message).toBe('IDEMPOTENCY_KEY_REUSED');

      // Cleanup
      await prisma.usageRecord.deleteMany({
        where: {
          requestId: { in: [inFlightKeyPrompt, inFlightKeyConv, unavailKey, reusedKey] },
        },
      });
      await prisma.conversation.deleteMany({ where: { id: convId } });
    });

    it('truncates older messages via sliding window and inspectContext matches dispatched payload', async () => {
      const providersService = app.get(ProvidersService);
      const prisma = app.get(PrismaService);

      let lastDispatchedMessages: any[] = [];
      jest.spyOn(providersService, 'executeChatCompletion').mockImplementation(async (params) => {
        lastDispatchedMessages = params.messages;
        return {
          success: true,
          model: params.model,
          content: 'Mock assistant response to turn',
          latencyMs: 20,
          usage: {
            promptTokens: 25,
            completionTokens: 15,
            totalTokens: 40,
            source: 'provider-reported',
          },
        };
      });

      // 1. Create a conversation with small contextBudget = 512 tokens
      const convRes = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({
          title: 'Context Budget Truncation Conv',
          provider: 'gateway',
          model: 'gpt-4o-mini',
          contextBudget: 512,
          systemPrompt: 'System instruction pinned: You are an architecture consultant.',
        })
        .expect(201);

      const convId = convRes.body.id;
      expect(convRes.body.contextBudget).toBe(512);

      try {
        // 2. Turn 1 (400 chars ~ 100 tokens)
        await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .send({ content: 'Turn 1 user: ' + 'A'.repeat(400) })
          .expect(201);

        // 3. Turn 2 (400 chars ~ 100 tokens)
        await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .send({ content: 'Turn 2 user: ' + 'B'.repeat(400) })
          .expect(201);

        // 4. Turn 3 (400 chars ~ 100 tokens)
        await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .send({ content: 'Turn 3 user: ' + 'C'.repeat(400) })
          .expect(201);

        // 5. Turn 4 with 800 chars (~200 tokens). Total history (541 tokens) now exceeds 512 tokens budget.
        const turn4Res = await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .send({ content: 'Turn 4 user: ' + 'D'.repeat(800) })
          .expect(201);

        expect(turn4Res.body.success).toBe(true);

        // Assert sliding window truncated oldest message(s):
        // System instruction is preserved
        expect(lastDispatchedMessages[0].role).toBe('system');
        expect(lastDispatchedMessages[0].content).toContain('System instruction pinned');

        // New user message is preserved
        const lastSent = lastDispatchedMessages[lastDispatchedMessages.length - 1];
        expect(lastSent.role).toBe('user');
        expect(lastSent.content).toContain('Turn 4 user');

        // Turn 1 content was truncated
        const dispatchedContents = lastDispatchedMessages.map((m) => m.content);
        expect(dispatchedContents.some((c) => c.includes('Turn 1 user'))).toBe(false);

        // 6. inspectContext reports identical truncation
        const inspectRes = await request(app.getHttpServer())
          .get(`/api/conversations/${convId}/context`)
          .set(authHeader)
          .expect(200);

        expect(inspectRes.body.inputBudget).toBe(512);
        expect(inspectRes.body.requestedBudget).toBe(512);
        expect(inspectRes.body.truncatedMessagesCount).toBeGreaterThan(0);
        expect(inspectRes.body.withinBudget).toBe(true);

        // System prompt and recent messages are in inspectRes.body.assembledMessages
        expect(inspectRes.body.assembledMessages[0].role).toBe('system');
        expect(inspectRes.body.assembledMessages[0].source).toBe('system-instruction');
        const inspectContents = inspectRes.body.assembledMessages.map((m: any) => m.content);
        expect(inspectContents.some((c: string) => c.includes('Turn 1 user'))).toBe(false);

        // 7. Impossible budget: message alone exceeds budget -> 409 CONTEXT_BUDGET_EXCEEDED
        const impossibleRes = await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .send({ content: 'word '.repeat(700) }) // 701 tokens > 600 budget
          .expect(409);

        expect(impossibleRes.body.status).toBe(409);
        expect(impossibleRes.body.code).toBe('CONTEXT_BUDGET_EXCEEDED');
      } finally {
        await prisma.conversation.deleteMany({ where: { id: convId } });
        jest.restoreAllMocks();
      }
    });

    it('compacts twice, resumes first checkpoint, and asserts inspectContext and provider payload use it', async () => {
      const providersService = app.get(ProvidersService);
      const prisma = app.get(PrismaService);

      let lastDispatchedMessages: any[] = [];
      jest.spyOn(providersService, 'executeChatCompletion').mockImplementation(async (req: any) => {
        lastDispatchedMessages = req.messages || [];
        return {
          success: true,
          content: 'Model assistant reply.',
          latencyMs: 15,
          model: 'gpt-4o-mini',
          usage: {
            promptTokens: 25,
            completionTokens: 15,
            totalTokens: 40,
            source: 'provider-reported',
          },
        };
      });

      // 1. Create a conversation
      const convRes = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({
          title: 'Resumable Checkpoints Integration Conv',
          provider: 'gateway',
          model: 'gpt-4o-mini',
          systemPrompt: 'System instruction pinned: You are a helpful assistant.',
        })
        .expect(201);

      const convId = convRes.body.id;

      try {
        // 2. Add 5 dialogue turns (messages up to sequence 11)
        for (let i = 1; i <= 5; i++) {
          await request(app.getHttpServer())
            .post(`/api/conversations/${convId}/messages`)
            .set(authHeader)
            .send({ content: `Turn ${i} user message` })
            .expect(201);
        }

        // 3. First compaction through turn 2 (sequence 5: sys 1, u 2, a 3, u 4, a 5)
        const comp1Res = await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/compact/apply`)
          .set(authHeader)
          .send({
            summary: 'Summary through turn 2 (seq 5)',
            compactedThroughSequence: 5,
            retainedFacts: ['Fact from turn 2'],
          })
          .expect(201);

        const chk1Id = comp1Res.body.checkpoint.id;
        expect(chk1Id).toBeDefined();

        // 4. Second compaction through turn 4 (sequence 9: u 6, a 7, u 8, a 9)
        const comp2Res = await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/compact/apply`)
          .set(authHeader)
          .send({
            summary: 'Summary through turn 4 (seq 9)',
            compactedThroughSequence: 9,
            retainedFacts: ['Fact from turn 4'],
          })
          .expect(201);

        const chk2Id = comp2Res.body.checkpoint.id;
        expect(chk2Id).toBeDefined();

        // Verify active checkpoint is currently chk2
        const inspectBeforeResume = await request(app.getHttpServer())
          .get(`/api/conversations/${convId}/context`)
          .set(authHeader)
          .expect(200);

        const chkMsgBefore = inspectBeforeResume.body.assembledMessages.find(
          (m: any) => m.source === 'checkpoint-summary',
        );
        expect(chkMsgBefore?.content).toContain('Summary through turn 4 (seq 9)');

        // 5. Resume the first checkpoint (chk1)
        const resumeRes = await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/resume`)
          .set(authHeader)
          .send({ checkpointId: chk1Id })
          .expect(200);

        expect(resumeRes.body.success).toBe(true);
        expect(resumeRes.body.activeCheckpoint.id).toBe(chk1Id);

        // 6. Assert inspectContext uses chk1 and retains messages after sequence 5
        const inspectAfterResume = await request(app.getHttpServer())
          .get(`/api/conversations/${convId}/context`)
          .set(authHeader)
          .expect(200);

        const chkMsgAfter = inspectAfterResume.body.assembledMessages.find(
          (m: any) => m.source === 'checkpoint-summary',
        );
        expect(chkMsgAfter?.content).toContain('Summary through turn 2 (seq 5)');

        // Messages after sequence 5 (e.g. sequence 6, 7, 8, 9, 10, 11) remain retained
        const retainedSeqs = inspectAfterResume.body.assembledMessages
          .filter((m: any) => m.source === 'retained-message')
          .map((m: any) => m.sequenceNumber);
        expect(retainedSeqs).toContain(6);
        expect(retainedSeqs).toContain(10);

        // 7. Send a new message and assert the dispatched provider payload uses chk1
        await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .send({ content: 'Message after resuming chk1' })
          .expect(201);

        const dispatchedChk = lastDispatchedMessages.find(
          (m: any) => m.content && m.content.includes('Summary through turn 2 (seq 5)'),
        );
        expect(dispatchedChk).toBeDefined();

        // Checkpoint 2 summary should NOT be present in dispatched payload
        const dispatchedChk2 = lastDispatchedMessages.find(
          (m: any) => m.content && m.content.includes('Summary through turn 4 (seq 9)'),
        );
        expect(dispatchedChk2).toBeUndefined();
      } finally {
        await prisma.conversation.deleteMany({ where: { id: convId } });
        jest.restoreAllMocks();
      }
    });

    it('serializes concurrent applyCompaction calls cleanly using row-level locking', async () => {
      const providersService = app.get(ProvidersService);
      const prisma = app.get(PrismaService);

      jest.spyOn(providersService, 'executeChatCompletion').mockResolvedValue({
        success: true,
        content: 'Assistant turn reply.',
        latencyMs: 15,
        model: 'gpt-4o-mini',
        usage: {
          promptTokens: 25,
          completionTokens: 15,
          totalTokens: 40,
          source: 'provider-reported',
        },
      });

      // 1. Create a conversation
      const convRes = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({
          title: 'Concurrent Compaction Serialization Conv',
          provider: 'gateway',
          model: 'gpt-4o-mini',
          systemPrompt: 'System instruction.',
        })
        .expect(201);

      const convId = convRes.body.id;

      try {
        // 2. Add 3 dialogue turns (messages up to sequence 7)
        for (let i = 1; i <= 3; i++) {
          await request(app.getHttpServer())
            .post(`/api/conversations/${convId}/messages`)
            .set(authHeader)
            .send({ content: `Turn ${i}` })
            .expect(201);
        }

        // 3. Issue two concurrent applyCompaction calls for sequence 4
        const [resA, resB] = await Promise.all([
          request(app.getHttpServer())
            .post(`/api/conversations/${convId}/compact/apply`)
            .set(authHeader)
            .send({
              summary: 'Compaction attempt A',
              compactedThroughSequence: 4,
              retainedFacts: ['Fact A'],
            }),
          request(app.getHttpServer())
            .post(`/api/conversations/${convId}/compact/apply`)
            .set(authHeader)
            .send({
              summary: 'Compaction attempt B',
              compactedThroughSequence: 4,
              retainedFacts: ['Fact B'],
            }),
        ]);

        const statuses = [resA.status, resB.status].sort();
        // One must succeed with 201; the second must cleanly reject with 400 INVALID_COMPACTION_RANGE
        expect(statuses).toEqual([201, 400]);

        const failedRes = resA.status === 400 ? resA : resB;
        expect(failedRes.body.code).toBe('INVALID_COMPACTION_RANGE');

        // Verify only 1 checkpoint was created in Postgres
        const checkpoints = await prisma.conversationCheckpoint.findMany({
          where: { conversationId: convId },
        });
        expect(checkpoints).toHaveLength(1);
        expect(checkpoints[0].compactedThroughSequence).toBe(4);
      } finally {
        await prisma.conversation.deleteMany({ where: { id: convId } });
        jest.restoreAllMocks();
      }
    });
  });

  describe('Per-User Rate Limiting & Idempotency Replay', () => {
    let convIdUser1: string;
    let convIdUser2: string;
    const user1Auth = { Authorization: 'Bearer dev-admin-token' }; // dev-user-001
    const user2Auth = { Authorization: 'Bearer dev-user-token' };  // user-002

    beforeEach(async () => {
      throttlerStorage.reset();
      const providersService = app.get(ProvidersService);
      jest.spyOn(providersService, 'executeChatCompletion').mockResolvedValue({
        success: true,
        content: 'Assistant turn reply.',
        latencyMs: 15,
        model: 'gpt-4o-mini',
        usage: {
          promptTokens: 25,
          completionTokens: 15,
          totalTokens: 40,
          source: 'provider-reported',
        },
      });

      const prisma = app.get(PrismaService);
      // Ensure users exist
      await prisma.user.upsert({
        where: { id: 'dev-user-001' },
        create: { id: 'dev-user-001', email: 'admin@dev.local', displayName: 'Admin User', role: 'admin' },
        update: {},
      });
      await prisma.user.upsert({
        where: { id: 'user-002' },
        create: { id: 'user-002', email: 'user@dev.local', displayName: 'Dev User', role: 'user' },
        update: {},
      });

      // Set a restrictive per-user limit for dev-user-001 (limit: 2 req/min)
      await prisma.quotaPolicy.upsert({
        where: { scope_scopeId: { scope: 'user', scopeId: 'dev-user-001' } },
        create: { scope: 'user', scopeId: 'dev-user-001', requestRateLimit: 2 },
        update: { requestRateLimit: 2 },
      });

      // Create conversation for dev-user-001
      const res1 = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(user1Auth)
        .send({
          title: 'User 1 Conv',
          provider: 'gateway',
          model: 'gpt-4o-mini',
          systemPrompt: 'System instruction.',
        })
        .expect(201);
      convIdUser1 = res1.body.id;

      // Create conversation for user-002
      const res2 = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(user2Auth)
        .send({
          title: 'User 2 Conv',
          provider: 'gateway',
          model: 'gpt-4o-mini',
          systemPrompt: 'System instruction.',
        })
        .expect(201);
      convIdUser2 = res2.body.id;
    });

    afterEach(async () => {
      const prisma = app.get(PrismaService);
      await prisma.conversation.deleteMany({
        where: { id: { in: [convIdUser1, convIdUser2].filter(Boolean) } },
      });
      await prisma.quotaPolicy.deleteMany({
        where: { scope: 'user', scopeId: 'dev-user-001' },
      });
      await prisma.usageRecord.deleteMany({
        where: { userId: { in: ['dev-user-001', 'user-002'] } },
      });
      jest.restoreAllMocks();
      throttlerStorage.reset();
    });

    it('enforces per-user limit with 429 RATE_LIMIT_EXCEEDED when exceeded', async () => {
      // User-001 limit is 2 req/min
      // Request 1: succeeds
      await request(app.getHttpServer())
        .post(`/api/conversations/${convIdUser1}/messages`)
        .set(user1Auth)
        .send({ content: 'Message 1' })
        .expect(201);

      // Request 2: succeeds
      await request(app.getHttpServer())
        .post(`/api/conversations/${convIdUser1}/messages`)
        .set(user1Auth)
        .send({ content: 'Message 2' })
        .expect(201);

      // Request 3: exceeds rate limit -> 429 RATE_LIMIT_EXCEEDED
      const blockedRes = await request(app.getHttpServer())
        .post(`/api/conversations/${convIdUser1}/messages`)
        .set(user1Auth)
        .send({ content: 'Message 3' });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(blockedRes.body.error).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('does not consume an extra rate-limit unit on an idempotent replay', async () => {
      const replayKey = 'quota-06-idemp-replay-key';

      // Request 1 with Idempotency-Key (consumes 1 unit, counter = 1)
      const res1 = await request(app.getHttpServer())
        .post(`/api/conversations/${convIdUser1}/messages`)
        .set(user1Auth)
        .set('Idempotency-Key', replayKey)
        .send({ content: 'Idempotent Turn' })
        .expect(201);

      expect(res1.body.success).toBe(true);

      // Request 2 with fresh key (consumes 2nd unit, counter = 2 = limit)
      await request(app.getHttpServer())
        .post(`/api/conversations/${convIdUser1}/messages`)
        .set(user1Auth)
        .set('Idempotency-Key', 'quota-06-fresh-key-2')
        .send({ content: 'Second Turn' })
        .expect(201);

      // A fresh 3rd request would exceed the limit (429)
      const blockedRes = await request(app.getHttpServer())
        .post(`/api/conversations/${convIdUser1}/messages`)
        .set(user1Auth)
        .set('Idempotency-Key', 'quota-06-fresh-key-3')
        .send({ content: 'Third Turn' });
      expect(blockedRes.status).toBe(429);

      // BUT replaying Request 1 with the same Idempotency-Key is recognized as a replay,
      // bypasses the counter, and returns the replayed response without 429
      const replayRes = await request(app.getHttpServer())
        .post(`/api/conversations/${convIdUser1}/messages`)
        .set(user1Auth)
        .set('Idempotency-Key', replayKey)
        .send({ content: 'Idempotent Turn' });

      expect(replayRes.status).toBe(201);
      expect(replayRes.body.success).toBe(true);
      expect(replayRes.body.userMessage.content).toBe('Idempotent Turn');
    });

    it('limits two different users independently', async () => {
      // User 1 uses up their limit of 2 requests
      await request(app.getHttpServer())
        .post(`/api/conversations/${convIdUser1}/messages`)
        .set(user1Auth)
        .send({ content: 'User 1 message 1' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/conversations/${convIdUser1}/messages`)
        .set(user1Auth)
        .send({ content: 'User 1 message 2' })
        .expect(201);

      // User 1 is now rate limited
      await request(app.getHttpServer())
        .post(`/api/conversations/${convIdUser1}/messages`)
        .set(user1Auth)
        .send({ content: 'User 1 message 3' })
        .expect(429);

      // User 2 (different user) is NOT blocked and can send messages successfully
      const user2Res = await request(app.getHttpServer())
        .post(`/api/conversations/${convIdUser2}/messages`)
        .set(user2Auth)
        .send({ content: 'User 2 message 1' });

      expect(user2Res.status).toBe(201);
      expect(user2Res.body.success).toBe(true);
    });
  });

  describe('Experiment Evaluations & Concurrent Ratings', () => {
    it('two concurrent rating updates for slots A and B of the same experiment both persist (no lost update)', async () => {
      const prisma = app.get(PrismaService);
      const exp = await prisma.experiment.create({
        data: {
          ownerId: 'dev-user-001',
          name: 'Concurrent Ratings Experiment',
          commonInput: '{"topic":"concurrent"}',
          settings: {},
          runs: {
            create: [
              { slot: 'A', provider: 'openai', model: 'gpt-4o-mini', status: 'completed' },
              { slot: 'B', provider: 'openai', model: 'gpt-4o-mini', status: 'completed' },
            ],
          },
        },
      });

      // Fire concurrent rating updates for slot A and slot B
      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/experiments/${exp.id}/rate`)
          .set(authHeader)
          .send({ slot: 'A', rating: 4, notes: 'Slot A rating' }),
        request(app.getHttpServer())
          .post(`/api/experiments/${exp.id}/rate`)
          .set(authHeader)
          .send({ slot: 'B', rating: 5, notes: 'Slot B rating' }),
      ]);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);

      const evals = await prisma.experimentEvaluation.findMany({
        where: { experimentId: exp.id },
        orderBy: { slot: 'asc' },
      });

      expect(evals).toHaveLength(2);
      expect(evals[0].slot).toBe('A');
      expect(evals[0].rating).toBe(4);
      expect(evals[0].notes).toBe('Slot A rating');
      expect(evals[1].slot).toBe('B');
      expect(evals[1].rating).toBe(5);
      expect(evals[1].notes).toBe('Slot B rating');
    });

    it('the same slot updated twice concurrently ends with one row', async () => {
      const prisma = app.get(PrismaService);
      const exp = await prisma.experiment.create({
        data: {
          ownerId: 'dev-user-001',
          name: 'Same Slot Concurrent Experiment',
          commonInput: '{}',
          settings: {},
        },
      });

      // Fire two concurrent updates to slot A
      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/experiments/${exp.id}/rate`)
          .set(authHeader)
          .send({ slot: 'A', rating: 3, notes: 'First rating' }),
        request(app.getHttpServer())
          .post(`/api/experiments/${exp.id}/rate`)
          .set(authHeader)
          .send({ slot: 'A', rating: 5, notes: 'Second rating' }),
      ]);

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);

      const evals = await prisma.experimentEvaluation.findMany({
        where: { experimentId: exp.id, slot: 'A' },
      });

      // Exactly one row must exist due to @@unique([experimentId, slot])
      expect(evals).toHaveLength(1);
      expect([3, 5]).toContain(evals[0].rating);
    });

    it('migration moves existing settings-JSON ratings into the new table', async () => {
      const prisma = app.get(PrismaService);

      // Seed legacy experiment with out-of-range ratings (0 and 7) and automated criteriaResults
      const legacyExp = await prisma.experiment.create({
        data: {
          ownerId: 'dev-user-001',
          name: 'Legacy Settings Experiment (0 and 7 ratings)',
          commonInput: '{"query":"legacy"}',
          settings: {
            evaluations: {
              A: {
                manualRating: 7,
                manualNotes: 'Legacy A feedback (rating 7)',
                criteriaResults: [{ criterionId: 'crit-1', passed: true }],
              },
              B: {
                manualRating: 0,
                manualNotes: 'Legacy B feedback (rating 0)',
                criteriaResults: [{ criterionId: 'crit-2', passed: false }],
              },
            },
          },
        },
      });

      // Helper to split SQL statements without breaking DO $$ ... $$ blocks
      const splitSqlStatements = (sql: string): string[] => {
        const statements: string[] = [];
        let current = '';
        let inDollarQuote = false;
        for (let i = 0; i < sql.length; i++) {
          const char = sql[i];
          const nextChar = sql[i + 1];
          if (char === '$' && nextChar === '$') {
            inDollarQuote = !inDollarQuote;
            current += '$$';
            i++;
            continue;
          }
          if (char === ';' && !inDollarQuote) {
            const trimmed = current.trim();
            if (trimmed.length > 0) statements.push(trimmed);
            current = '';
            continue;
          }
          current += char;
        }
        const trimmed = current.trim();
        if (trimmed.length > 0) statements.push(trimmed);
        return statements;
      };

      // Temporarily drop CHECK constraints if present so Migration 1 can backfill raw legacy values
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "experiment_evaluations" DROP CONSTRAINT IF EXISTS "experiment_evaluations_rating_check"',
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "experiment_evaluations" DROP CONSTRAINT IF EXISTS "experiment_evaluations_slot_check"',
      );

      // 1. Apply Migration 1 (20261026040000_exp_02_experiment_evaluations/migration.sql)
      const migration1Path = path.join(
        __dirname,
        '../prisma/migrations/20261026040000_exp_02_experiment_evaluations/migration.sql',
      );
      const migration1Sql = fs.readFileSync(migration1Path, 'utf8');
      for (const stmt of splitSqlStatements(migration1Sql)) {
        await prisma.$executeRawUnsafe(stmt);
      }

      // Verify that after Migration 1: ratings 7 and 0 were copied, criteriaScores received automated results
      const midEvals = await prisma.experimentEvaluation.findMany({
        where: { experimentId: legacyExp.id },
        orderBy: { slot: 'asc' },
      });
      expect(midEvals).toHaveLength(2);
      expect(midEvals[0].rating).toBe(7);
      expect(midEvals[0].criteriaScores).toEqual([{ criterionId: 'crit-1', passed: true }]);
      expect(midEvals[1].rating).toBe(0);
      expect(midEvals[1].criteriaScores).toEqual([{ criterionId: 'crit-2', passed: false }]);

      // 2. Apply Migration 2 (20261026050000_exp_02b_evaluation_constraints/migration.sql)
      const migration2Path = path.join(
        __dirname,
        '../prisma/migrations/20261026050000_exp_02b_evaluation_constraints/migration.sql',
      );
      const migration2Sql = fs.readFileSync(migration2Path, 'utf8');
      for (const stmt of splitSqlStatements(migration2Sql)) {
        await prisma.$executeRawUnsafe(stmt);
      }

      // Verify final migrated state after Migration 2:
      // ratings 7 and 0 -> NULL with notes kept; criteriaScores -> NULL (manual scores only)
      const finalEvals = await prisma.experimentEvaluation.findMany({
        where: { experimentId: legacyExp.id },
        orderBy: { slot: 'asc' },
      });

      expect(finalEvals).toHaveLength(2);
      expect(finalEvals[0].slot).toBe('A');
      expect(finalEvals[0].rating).toBeNull();
      expect(finalEvals[0].notes).toBe('Legacy A feedback (rating 7)');
      expect(finalEvals[0].criteriaScores).toBeNull();

      expect(finalEvals[1].slot).toBe('B');
      expect(finalEvals[1].rating).toBeNull();
      expect(finalEvals[1].notes).toBe('Legacy B feedback (rating 0)');
      expect(finalEvals[1].criteriaScores).toBeNull();

      // Verify that GET /api/experiments/:id returns the evaluations seamlessly with automated criteriaResults from settings
      const res = await request(app.getHttpServer())
        .get(`/api/experiments/${legacyExp.id}`)
        .set(authHeader)
        .expect(200);

      expect(res.body.evaluations.A.manualRating).toBeNull();
      expect(res.body.evaluations.A.manualNotes).toBe('Legacy A feedback (rating 7)');
      expect(res.body.evaluations.A.criteriaResults).toEqual([{ criterionId: 'crit-1', passed: true }]);
      expect(res.body.evaluations.A.criteriaScores).toBeUndefined();

      expect(res.body.evaluations.B.manualRating).toBeNull();
      expect(res.body.evaluations.B.manualNotes).toBe('Legacy B feedback (rating 0)');
      expect(res.body.evaluations.B.criteriaResults).toEqual([{ criterionId: 'crit-2', passed: false }]);
      expect(res.body.evaluations.B.criteriaScores).toBeUndefined();

      // Verify DB CHECK constraint rejects out-of-range rating insert (e.g. 6)
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "experiment_evaluations" ("id", "experimentId", "slot", "rating", "notes", "createdAt", "updatedAt")
          VALUES ('check-fail-rating', '${legacyExp.id}', 'A', 6, 'Invalid rating', NOW(), NOW());
        `)
      ).rejects.toThrow();

      // Verify DB CHECK constraint rejects invalid slot (e.g. 'C')
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "experiment_evaluations" ("id", "experimentId", "slot", "rating", "notes", "createdAt", "updatedAt")
          VALUES ('check-fail-slot', '${legacyExp.id}', 'C', 3, 'Invalid slot', NOW(), NOW());
        `)
      ).rejects.toThrow();
    });
  });

  describe('Model Catalog & Gateway Error Classification', () => {
    const origFetch = global.fetch;
    let modelCatalog: ModelCatalogService;

    beforeAll(() => {
      modelCatalog = app.get(ModelCatalogService);
    });

    beforeEach(() => {
      modelCatalog.clearCache();
    });

    afterEach(() => {
      global.fetch = origFetch;
      modelCatalog.clearCache();
    });

    afterAll(() => {
      global.fetch = origFetch;
    });

    it('derives context budget and records cost from mocked LiteLLM gateway in a real conversation turn', async () => {
      global.fetch = jest.fn().mockImplementation((input: any) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url.includes('/model/info')) {
          const body = {
            data: [
              {
                model_name: 'gpt-custom-mock',
                litellm_params: { model: 'openai/gpt-custom-mock' },
                model_info: {
                  max_input_tokens: 64000,
                  max_output_tokens: 4096,
                  input_cost_per_token: 0.0000002,
                  output_cost_per_token: 0.0000008,
                },
              },
            ],
          };
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify(body),
            json: async () => body,
          } as Response);
        }

        if (url.includes('/chat/completions')) {
          const headers = new Headers();
          headers.set('x-litellm-response-cost', '0.000042');
          const body = {
            id: 'chatcmpl-mock-123',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Gateway turn completed successfully',
                },
              },
            ],
            usage: {
              prompt_tokens: 15,
              completion_tokens: 25,
              total_tokens: 40,
            },
          };
          return Promise.resolve({
            ok: true,
            status: 200,
            headers,
            text: async () => JSON.stringify(body),
            json: async () => body,
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ status: 'ok' }),
          json: async () => ({ status: 'ok' }),
        } as Response);
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({
          title: 'Catalog Integration Test Conv',
          provider: 'openai',
          model: 'gpt-custom-mock',
        })
        .expect(201);

      const convId = createRes.body.id;

      const contextRes = await request(app.getHttpServer())
        .get(`/api/conversations/${convId}/context`)
        .set(authHeader)
        .expect(200);

      expect(contextRes.body.contextWindow).toBe(64000);
      expect(contextRes.body.reservedOutputTokens).toBe(4096);
      expect(contextRes.body.contextLimitStatus).toBe('known');

      const msgRes = await request(app.getHttpServer())
        .post(`/api/conversations/${convId}/messages`)
        .set(authHeader)
        .send({ content: 'Hello from catalog integration test' })
        .expect(201);

      expect(msgRes.body.success).toBe(true);
      expect(msgRes.body.assistantMessage.content).toBe('Gateway turn completed successfully');

      const prismaService = app.get(PrismaService);
      const usageRecord = await prismaService.usageRecord.findFirst({
        where: {
          conversationId: convId,
          status: 'reconciled',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(usageRecord).toBeDefined();
      expect(usageRecord?.estimatedCost).toBe(0.000042);
      expect((usageRecord?.responseBody as any)?.costSource).toBe('provider-reported');
      expect((usageRecord?.responseBody as any)?.cost).toBe(0.000042);
    });

    it('classifies gateway 500 error structurally without false-positive quota matching', async () => {
      global.fetch = jest.fn().mockImplementation((input: any) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url.includes('/model/info')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                data: [
                  {
                    model_name: 'gpt-4o-mini',
                    litellm_params: { model: 'openai/gpt-4o-mini' },
                    model_info: { max_input_tokens: 128000, max_output_tokens: 16384 },
                  },
                ],
              }),
            json: async () => ({
              data: [
                {
                  model_name: 'gpt-4o-mini',
                  litellm_params: { model: 'openai/gpt-4o-mini' },
                  model_info: { max_input_tokens: 128000, max_output_tokens: 16384 },
                },
              ],
            }),
          } as Response);
        }

        if (url.includes('/chat/completions')) {
          const body = JSON.stringify({
            error: {
              message: 'Internal server error: upstream database quota reached',
              type: 'internal_server_error',
            },
          });
          return Promise.resolve({
            ok: false,
            status: 500,
            text: async () => body,
            json: async () => JSON.parse(body),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true }),
          json: async () => ({ ok: true }),
        } as Response);
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({
          title: 'Error Classification Test',
          provider: 'openai',
          model: 'gpt-4o-mini',
        })
        .expect(201);

      const convId = createRes.body.id;

      const sendRes = await request(app.getHttpServer())
        .post(`/api/conversations/${convId}/messages`)
        .set(authHeader)
        .send({ content: 'Trigger error turn' });

      expect(sendRes.status).toBe(201);
      expect(sendRes.body.success).toBe(false);
      expect(sendRes.body.errorType).toBe('provider_error');
      expect(sendRes.body.errorType).not.toBe('quota_exceeded');

      const prismaService = app.get(PrismaService);
      const errRecord = await prismaService.usageRecord.findFirst({
        where: {
          conversationId: convId,
          status: 'failed',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(errRecord).toBeDefined();
      expect((errRecord?.responseBody as any)?.upstreamStatus).toBe(500);
    });
  });

  describe('Model-Aware Token Counter', () => {
    it('POST /api/tokens/estimate returns model-aware token count and method behind auth', async () => {
      // 1. Unauthenticated request is rejected
      await request(app.getHttpServer())
        .post('/api/tokens/estimate')
        .send({ model: 'gpt-4o', text: 'Hello world' })
        .expect(401);

      // 2. Exact token count for gpt-4o (o200k_base)
      const exactRes = await request(app.getHttpServer())
        .post('/api/tokens/estimate')
        .set(authHeader)
        .send({ model: 'gpt-4o', text: 'Hello world' })
        .expect(200);

      expect(exactRes.body).toEqual({
        tokens: 2,
        method: 'tiktoken:o200k_base',
      });

      // 3. Approximate token count for Claude (Anthropic)
      const approxRes = await request(app.getHttpServer())
        .post('/api/tokens/estimate')
        .set(authHeader)
        .send({ model: 'claude-3-5-sonnet', provider: 'anthropic', text: 'Hello world' })
        .expect(200);

      expect(approxRes.body).toEqual({
        tokens: 2,
        method: 'approximate:o200k_base',
      });

      // 4. Chat messages format with message framing overhead
      const chatRes = await request(app.getHttpServer())
        .post('/api/tokens/estimate')
        .set(authHeader)
        .send({
          model: 'gpt-4o',
          messages: [
            { role: 'user', content: 'Hello world' },
          ],
        })
        .expect(200);

      // 2 content tokens ('Hello world') + 1 role token ('user') + 3 message framing tokens + 3 assistant priming = 9
      expect(chatRes.body.tokens).toBe(9);
      expect(chatRes.body.method).toBe('tiktoken:o200k_base');
    });

    it("a conversation's inspectContext tokens and its reservation estimate both come from the tokenizer, with the method reported", async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(authHeader)
        .send({
          title: 'Token Counter Integration Conversation',
          provider: 'openai',
          model: 'gpt-4o',
          systemPrompt: 'You are a helpful assistant.',
        })
        .expect(201);

      const convId = createRes.body.id;

      // 1. inspectContext tokens come from tokenizer and report method
      const inspectRes = await request(app.getHttpServer())
        .get(`/api/conversations/${convId}/context?proposedInput=Hello%20world`)
        .set(authHeader)
        .expect(200);

      expect(inspectRes.body.tokenEstimationMethod).toBe('tiktoken:o200k_base');
      expect(inspectRes.body.totalEstimatedInputTokens).toBeGreaterThan(0);

      // 2. Reservation estimate in usageRecord comes from tokenizer messages count
      const origFetch = global.fetch;
      try {
        global.fetch = jest.fn().mockImplementation((url: string) => {
          if (url.includes('/chat/completions')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: new Headers({
                'content-type': 'application/json',
                'x-litellm-response-cost': '0.00010',
              }),
              text: async () =>
                JSON.stringify({
                  id: 'chatcmpl-token-01',
                  object: 'chat.completion',
                  model: 'gpt-4o',
                  choices: [{ message: { role: 'assistant', content: 'Greetings!' } }],
                  usage: { prompt_tokens: 15, completion_tokens: 3, total_tokens: 18 },
                }),
              json: async () => ({
                id: 'chatcmpl-token-01',
                choices: [{ message: { role: 'assistant', content: 'Greetings!' } }],
                usage: { prompt_tokens: 15, completion_tokens: 3, total_tokens: 18 },
              }),
            } as Response);
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true }),
            json: async () => ({ ok: true }),
          } as Response);
        });

        const sendRes = await request(app.getHttpServer())
          .post(`/api/conversations/${convId}/messages`)
          .set(authHeader)
          .send({ content: 'Hello world' })
          .expect(201);

        expect(sendRes.body.success).toBe(true);

        const prismaService = app.get(PrismaService);
        const record = await prismaService.usageRecord.findFirst({
          where: { conversationId: convId },
          orderBy: { createdAt: 'desc' },
        });

        expect(record).toBeDefined();
        // Reservation tokens: inputEstimate (via tokenizer messages framing) + maxTokens (1024)
        expect(record?.reservedTokens).toBeGreaterThan(1024);
      } finally {
        global.fetch = origFetch;
      }
    });
  });

});


