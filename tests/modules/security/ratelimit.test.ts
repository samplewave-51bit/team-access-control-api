import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import { app } from '../../../src/app';
import { getRateLimiter } from '../../../src/config/rateLimits';
import { redis } from '../../../src/lib/redis';
import { errorHandler } from '../../../src/middleware/errorHandler';
import { createRateLimiterMiddleware } from '../../../src/middleware/rateLimit';
import { disconnectDatabase, resetDatabase } from '../../helpers/db';

describe('Security: Redis-Backed Rate Limiting (C16)', () => {
  beforeEach(async () => {
    await resetDatabase();
    // Flush test Redis database (DB 1) before each test
    await redis.flushdb();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  describe('Rate Limiter Middleware Core Mechanics', () => {
    it('sets RateLimit-Limit, RateLimit-Remaining, and RateLimit-Reset headers on allowed requests', async () => {
      const testApp: Express = express();
      testApp.use(
        '/test-headers',
        createRateLimiterMiddleware({
          keyPrefix: 'test:headers',
          points: 5,
          duration: 10,
          keyGenerator: () => 'test-client',
        }),
        (_req: Request, res: Response) => {
          res.json({ ok: true });
        },
      );
      testApp.use(errorHandler);

      const res = await request(testApp).get('/test-headers');
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('5');
      expect(res.headers['ratelimit-remaining']).toBe('4');
      expect(res.headers['ratelimit-reset']).toBeDefined();
    });

    it('returns 429 Too Many Requests with Retry-After header when points are exhausted', async () => {
      const testApp: Express = express();
      testApp.use(
        '/test-exhaust',
        createRateLimiterMiddleware({
          keyPrefix: 'test:exhaust',
          points: 2,
          duration: 5,
          keyGenerator: () => 'client-exhaust',
        }),
        (_req: Request, res: Response) => {
          res.json({ ok: true });
        },
      );
      testApp.use(errorHandler);

      // Consume 2 points
      const res1 = await request(testApp).get('/test-exhaust');
      expect(res1.status).toBe(200);
      const res2 = await request(testApp).get('/test-exhaust');
      expect(res2.status).toBe(200);

      // 3rd request should exceed points limit
      const res3 = await request(testApp).get('/test-exhaust');
      expect(res3.status).toBe(429);
      expect(res3.body.error.code).toBe('TOO_MANY_REQUESTS');
      expect(res3.headers['retry-after']).toBeDefined();
      expect(Number(res3.headers['retry-after'])).toBeGreaterThan(0);
      expect(res3.headers['ratelimit-remaining']).toBe('0');
      expect(res3.headers['ratelimit-limit']).toBe('2');
    });

    it('resets allowed points after duration window expires', async () => {
      const testApp: Express = express();
      testApp.use(
        '/test-window',
        createRateLimiterMiddleware({
          keyPrefix: 'test:window',
          points: 1,
          duration: 1, // 1 second window
          keyGenerator: () => 'client-window',
        }),
        (_req: Request, res: Response) => {
          res.json({ ok: true });
        },
      );
      testApp.use(errorHandler);

      // 1st request succeeds
      const res1 = await request(testApp).get('/test-window');
      expect(res1.status).toBe(200);

      // 2nd immediate request fails
      const res2 = await request(testApp).get('/test-window');
      expect(res2.status).toBe(429);

      // Wait 1.1s for window to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // 3rd request succeeds again
      const res3 = await request(testApp).get('/test-window');
      expect(res3.status).toBe(200);
      expect(res3.headers['ratelimit-remaining']).toBe('0');
    });
  });

  describe('Route-Specific Limits Integration on Main App', () => {
    it('enforces brute-force rate limit on POST /api/v1/auth/login and sets 429 after point exhaustion', async () => {
      // First create a user to attempt login against
      await request(app).post('/api/v1/auth/register').send({
        email: 'brute@test.com',
        name: 'Brute Test',
        password: 'SafePassword123!',
      });

      // Override the login rate limiter in our limiter cache to use 3 points for test speed
      const loginLimiter = getRateLimiter({
        keyPrefix: 'rl:login',
        points: 3,
        duration: 10,
      });
      // Set points to 3 on the instance
      (loginLimiter as unknown as { points: number }).points = 3;

      // Make 3 login requests
      for (let i = 0; i < 3; i++) {
        const res = await request(app).post('/api/v1/auth/login').send({
          email: 'brute@test.com',
          password: 'WrongPassword123!',
        });
        expect([401, 200]).toContain(res.status);
      }

      // 4th request exceeds rate limit
      const resBlocked = await request(app).post('/api/v1/auth/login').send({
        email: 'brute@test.com',
        password: 'WrongPassword123!',
      });

      expect(resBlocked.status).toBe(429);
      expect(resBlocked.body.error.code).toBe('TOO_MANY_REQUESTS');
      expect(resBlocked.headers['retry-after']).toBeDefined();
    });

    it('enforces rate limit on POST /api/v1/auth/register per IP', async () => {
      const regLimiter = getRateLimiter({
        keyPrefix: 'rl:register',
        points: 2,
        duration: 10,
      });
      (regLimiter as unknown as { points: number }).points = 2;

      // Request 1
      const res1 = await request(app).post('/api/v1/auth/register').send({
        email: 'reg1@test.com',
        name: 'Reg 1',
        password: 'SafePassword123!',
      });
      expect(res1.status).toBe(201);

      // Request 2
      const res2 = await request(app).post('/api/v1/auth/register').send({
        email: 'reg2@test.com',
        name: 'Reg 2',
        password: 'SafePassword123!',
      });
      expect(res2.status).toBe(201);

      // Request 3 should hit 429
      const res3 = await request(app).post('/api/v1/auth/register').send({
        email: 'reg3@test.com',
        name: 'Reg 3',
        password: 'SafePassword123!',
      });
      expect(res3.status).toBe(429);
      expect(res3.body.error.code).toBe('TOO_MANY_REQUESTS');
    });

    it('enforces invitation rate limiting per organization', async () => {
      // Register owner and login
      await request(app).post('/api/v1/auth/register').send({
        email: 'owner-invite@test.com',
        name: 'Owner',
        password: 'SafePassword123!',
      });

      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: 'owner-invite@test.com',
        password: 'SafePassword123!',
      });
      const token = loginRes.body.accessToken;

      const orgRes = await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Invite Rate Org' });
      expect(orgRes.status).toBe(201);
      const orgId = orgRes.body.organization.id;

      // Get member role
      const rolesRes = await request(app)
        .get(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${token}`);
      const memberRole = rolesRes.body.roles.find((r: { name: string }) => r.name === 'member');

      const inviteLimiter = getRateLimiter({
        keyPrefix: 'rl:invite',
        points: 2,
        duration: 10,
      });
      (inviteLimiter as unknown as { points: number }).points = 2;

      // 1st invite
      const inv1 = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'inv1@test.com', roleId: memberRole.id });
      expect(inv1.status).toBe(201);

      // 2nd invite
      const inv2 = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'inv2@test.com', roleId: memberRole.id });
      expect(inv2.status).toBe(201);

      // 3rd invite hits 429
      const inv3 = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'inv3@test.com', roleId: memberRole.id });
      expect(inv3.status).toBe(429);
      expect(inv3.body.error.code).toBe('TOO_MANY_REQUESTS');
    });
  });
});
