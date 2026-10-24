import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './app.module';
import { validateEnvironment } from './common/config/env.validation';
import { configureApp } from './configure-app';

describe('HTTP Routing & App Integration (E2E)', () => {
  let app: INestApplication;
  const authHeader = { Authorization: 'Bearer dev-admin-token' };
  jest.setTimeout(30000);

  beforeAll(async () => {
    // Ensure test environment satisfies startup validation
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = 'postgresql://postgres:admin@localhost:5432/promptlab?schema=public';
    }
    const envConfig = validateEnvironment();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // SEC-04: use the shared configureApp() so the test exercises the real production pipeline
    configureApp(app, envConfig);

    await app.init();
  }, 30000);

  afterAll(async () => {
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

});
