import request from 'supertest';
import { app } from '../../../src/app';
import { disconnectDatabase, resetDatabase, testPrisma } from '../../helpers/db';

describe('POST /api/v1/auth/logout & /api/v1/auth/logout-all', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  const testUser = {
    email: 'logout.test@example.com',
    name: 'Logout Tester',
    password: 'SafePassword123!',
  };

  async function registerAndLogin() {
    await request(app).post('/api/v1/auth/register').send(testUser);
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: testUser.email,
      password: testUser.password,
    });
    return loginRes.body.accessToken;
  }

  describe('POST /api/v1/auth/logout', () => {
    it('should successfully log out and invalidate access token immediately', async () => {
      const accessToken = await registerAndLogin();

      // Verify access token works initially
      const meBefore = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(meBefore.status).toBe(200);

      // Perform logout
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.message).toBe('Logged out successfully');

      // Verify access token is rejected immediately
      const meAfter = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(meAfter.status).toBe(401);
      expect(meAfter.body.error.message).toContain('Session has expired or been revoked');
    });
  });

  describe('POST /api/v1/auth/logout-all', () => {
    it('should log out all sessions and invalidate all active tokens for the user', async () => {
      await request(app).post('/api/v1/auth/register').send(testUser);

      // Device 1 login
      const login1 = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });
      const token1 = login1.body.accessToken;

      // Device 2 login
      const login2 = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });
      const token2 = login2.body.accessToken;

      // Verify both tokens work
      expect(
        (await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token1}`)).status,
      ).toBe(200);
      expect(
        (await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token2}`)).status,
      ).toBe(200);

      // Call logout-all using token1
      const logoutAllRes = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${token1}`);

      expect(logoutAllRes.status).toBe(200);
      expect(logoutAllRes.body.message).toContain('Logged out from all devices');

      // Both tokens must now be rejected
      const res1 = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token1}`);
      expect(res1.status).toBe(401);

      const res2 = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token2}`);
      expect(res2.status).toBe(401);

      // Verify all DB sessions are revoked
      const sessions = await testPrisma.session.findMany({
        where: { user: { email: testUser.email } },
      });
      for (const s of sessions) {
        expect(s.revokedAt).not.toBeNull();
      }
    });
  });
});
