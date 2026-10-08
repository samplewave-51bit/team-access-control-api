import request from 'supertest';
import { app } from '../../../src/app';
import { disconnectDatabase, resetDatabase, testPrisma } from '../../helpers/db';

describe('POST /api/v1/auth/refresh', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  const testUser = {
    email: 'refresh.test@example.com',
    name: 'Refresh Tester',
    password: 'SafePassword123!',
  };

  async function loginAndGetCookie() {
    await request(app).post('/api/v1/auth/register').send(testUser);
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: testUser.email,
      password: testUser.password,
    });

    const cookieHeader = loginRes.headers['set-cookie'] as unknown as string[];
    const refreshCookie = cookieHeader.find((c) => c.startsWith('refreshToken='));
    const token = refreshCookie!.split(';')[0];
    return { loginRes, cookie: token };
  }

  it('should successfully rotate refresh token and issue a new access token', async () => {
    const { cookie } = await loginAndGetCookie();

    const refreshRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', [cookie]);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeDefined();

    // Verify new rotated cookie was sent
    const newCookieHeader = refreshRes.headers['set-cookie'] as unknown as string[];
    const newRefreshCookie = newCookieHeader.find((c) => c.startsWith('refreshToken='));
    expect(newRefreshCookie).toBeDefined();
    expect(newRefreshCookie).not.toBe(cookie);

    // Verify DB states: old session has revokedAt and replacedById set; new session is active in same family
    const sessions = await testPrisma.session.findMany({
      orderBy: { createdAt: 'asc' },
    });

    expect(sessions).toHaveLength(2);
    expect(sessions[0].revokedAt).not.toBeNull();
    expect(sessions[0].replacedById).toBe(sessions[1].id);
    expect(sessions[1].revokedAt).toBeNull();
    expect(sessions[1].familyId).toBe(sessions[0].familyId);
  });

  it('should return 401 when no refresh token cookie is provided', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('should return 401 when refresh token is invalid', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', ['refreshToken=invalid-non-existent-token']);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('should detect reuse outside grace window and revoke the entire session family', async () => {
    const { cookie: initialCookie } = await loginAndGetCookie();

    // 1st rotation (legitimate)
    const firstRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [initialCookie]);

    expect(firstRefresh.status).toBe(200);
    const newAccessToken = firstRefresh.body.accessToken;

    // Simulate passage of time past grace window (15 seconds)
    const oldSessions = await testPrisma.session.findMany({
      orderBy: { createdAt: 'asc' },
    });
    await testPrisma.session.update({
      where: { id: oldSessions[0].id },
      data: { revokedAt: new Date(Date.now() - 15000) },
    });

    // 2nd rotation attempt with the already-rotated initial token -> REUSE DETECTED!
    const reuseRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', [initialCookie]);

    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.error.message).toContain('Refresh token reuse detected');

    // Verify all sessions in that family are now revoked in DB
    const allSessions = await testPrisma.session.findMany({
      where: { familyId: oldSessions[0].familyId },
    });
    for (const s of allSessions) {
      expect(s.revokedAt).not.toBeNull();
    }

    // Verify that the new access token issued during the legitimate rotation is now rejected immediately
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${newAccessToken}`);

    expect(meRes.status).toBe(401);
  });
});
