import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../../../src/app';
import { env } from '../../../src/config/env';
import { hashToken } from '../../../src/lib/tokens';
import { disconnectDatabase, resetDatabase, testPrisma } from '../../helpers/db';

describe('POST /api/v1/auth/login & GET /api/v1/auth/me', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  const testUser = {
    email: 'login.test@example.com',
    name: 'Login Test',
    password: 'SecurePassword123!',
  };

  async function registerTestUser() {
    return request(app).post('/api/v1/auth/register').send(testUser);
  }

  describe('POST /api/v1/auth/login', () => {
    it('should successfully log in, return access token, and set refresh cookie', async () => {
      await registerTestUser();

      const res = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email);

      // Verify cookie
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const refreshCookie = (cookies as unknown as string[]).find((c) =>
        c.startsWith('refreshToken='),
      );
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('HttpOnly');
      expect(refreshCookie).toContain('Path=/api/v1/auth');
      expect(refreshCookie).toContain('SameSite=Strict');

      // Verify session created in DB
      const sessions = await testPrisma.session.findMany({
        where: { user: { email: testUser.email } },
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].revokedAt).toBeNull();
      expect(sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Extract raw token from cookie and verify hash matches DB
      const rawToken = refreshCookie!.split(';')[0].split('=')[1];
      expect(sessions[0].refreshTokenHash).toBe(hashToken(rawToken));
    });

    it('should return 401 when password is incorrect and increment failed count', async () => {
      await registerTestUser();

      const res = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: 'WrongPassword123!',
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Invalid email or password');

      const user = await testPrisma.user.findUnique({
        where: { email: testUser.email },
      });
      expect(user?.failedLoginCount).toBe(1);
    });

    it('should return 401 when user does not exist', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'nonexistent@example.com',
        password: 'SomePassword123!',
      });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('should lock account after 5 consecutive failed login attempts', async () => {
      await registerTestUser();

      // 4 failed attempts
      for (let i = 0; i < 4; i++) {
        const res = await request(app).post('/api/v1/auth/login').send({
          email: testUser.email,
          password: 'BadPassword!',
        });
        expect(res.status).toBe(401);
      }

      // 5th failed attempt triggers lockout
      const fifthRes = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: 'BadPassword!',
      });
      expect(fifthRes.status).toBe(401);

      const dbUser = await testPrisma.user.findUnique({
        where: { email: testUser.email },
      });
      expect(dbUser?.failedLoginCount).toBe(5);
      expect(dbUser?.lockedUntil).not.toBeNull();
      expect(dbUser!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      // 6th attempt (even with correct password) returns lockout message
      const lockedRes = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });
      expect(lockedRes.status).toBe(401);
      expect(lockedRes.body.error.message).toContain('Account is temporarily locked');
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return user profile when valid access token is provided', async () => {
      await registerTestUser();

      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });

      const token = loginRes.body.accessToken;

      const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email);
      expect(res.body.user.name).toBe(testUser.name);
    });

    it('should return 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 when token is invalid or corrupted', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.token.payload');

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('Invalid authentication token');
    });

    it('should return 401 when token is expired', async () => {
      await registerTestUser();

      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });

      const dbSession = await testPrisma.session.findFirst({
        where: { user: { email: testUser.email } },
      });

      // Create expired token manually
      const expiredToken = jwt.sign(
        {
          sub: loginRes.body.user.id,
          sid: dbSession!.id,
          jti: 'expired-jti',
        },
        env.JWT_ACCESS_SECRET,
        { expiresIn: '-1s' },
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('Authentication token has expired');
    });

    it('should return 401 when session has been revoked in database', async () => {
      await registerTestUser();

      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });

      const token = loginRes.body.accessToken;

      // Revoke session in DB
      await testPrisma.session.updateMany({
        where: { user: { email: testUser.email } },
        data: { revokedAt: new Date() },
      });

      const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('Session has expired or been revoked');
    });
  });
});
