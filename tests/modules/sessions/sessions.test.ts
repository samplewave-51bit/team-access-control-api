import request from 'supertest';
import { app } from '../../../src/app';
import { disconnectDatabase, resetDatabase, testPrisma } from '../../helpers/db';

describe('Sessions Module (Own & Admin Revocation)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  async function registerAndLogin(email: string, name: string) {
    await request(app).post('/api/v1/auth/register').send({
      email,
      name,
      password: 'SafePassword123!',
    });

    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email,
      password: 'SafePassword123!',
    });

    return {
      token: loginRes.body.accessToken,
      user: loginRes.body.user,
    };
  }

  async function setupOrgWithUsers() {
    const owner = await registerAndLogin('owner@sessions.test', 'Owner User');
    const admin = await registerAndLogin('admin@sessions.test', 'Admin User');
    const member = await registerAndLogin('member@sessions.test', 'Member User');
    const viewer = await registerAndLogin('viewer@sessions.test', 'Viewer User');
    const outsider = await registerAndLogin('outsider@sessions.test', 'Outsider User');

    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Sessions Org' });
    const orgId = orgRes.body.organization.id;

    const roles = await testPrisma.role.findMany({ where: { orgId } });
    const adminRole = roles.find((r) => r.name === 'admin')!;
    const memberRole = roles.find((r) => r.name === 'member')!;
    const viewerRole = roles.find((r) => r.name === 'viewer')!;

    await testPrisma.membership.create({
      data: {
        userId: admin.user.id,
        orgId,
        roleId: adminRole.id,
        status: 'ACTIVE',
      },
    });

    await testPrisma.membership.create({
      data: {
        userId: member.user.id,
        orgId,
        roleId: memberRole.id,
        status: 'ACTIVE',
      },
    });

    await testPrisma.membership.create({
      data: {
        userId: viewer.user.id,
        orgId,
        roleId: viewerRole.id,
        status: 'ACTIVE',
      },
    });

    return { owner, admin, member, viewer, outsider, orgId, roles };
  }

  describe('GET /api/v1/sessions (List own active sessions)', () => {
    it('returns own active sessions with isCurrent flag', async () => {
      const user = await registerAndLogin('user1@sessions.test', 'User 1');

      // Login second time to create a second session
      const login2 = await request(app).post('/api/v1/auth/login').send({
        email: 'user1@sessions.test',
        password: 'SafePassword123!',
      });
      const token2 = login2.body.accessToken;

      const res = await request(app)
        .get('/api/v1/sessions')
        .set('Authorization', `Bearer ${token2}`);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toBeDefined();
      expect(res.body.sessions.length).toBe(2);

      // Verify isCurrent is true for the session used in the request
      const current = res.body.sessions.find((s: { isCurrent: boolean }) => s.isCurrent);
      expect(current).toBeDefined();

      // Verify session properties
      expect(current).toHaveProperty('id');
      expect(current).toHaveProperty('familyId');
      expect(current).toHaveProperty('expiresAt');
      expect(current).toHaveProperty('createdAt');
      expect(current.userId).toBe(user.user.id);
    });

    it('does not return revoked or expired sessions', async () => {
      const user = await registerAndLogin('user2@sessions.test', 'User 2');

      // Create a revoked session
      await testPrisma.session.create({
        data: {
          userId: user.user.id,
          familyId: '123e4567-e89b-12d3-a456-426614174099',
          refreshTokenHash: 'hash-revoked',
          expiresAt: new Date(Date.now() + 86400000),
          revokedAt: new Date(),
        },
      });

      // Create an expired session
      await testPrisma.session.create({
        data: {
          userId: user.user.id,
          familyId: '123e4567-e89b-12d3-a456-426614174098',
          refreshTokenHash: 'hash-expired',
          expiresAt: new Date(Date.now() - 10000),
        },
      });

      const res = await request(app)
        .get('/api/v1/sessions')
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(1);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await request(app).get('/api/v1/sessions');
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/v1/sessions/:id (Revoke own session)', () => {
    it('revokes own session and immediately invalidates access token', async () => {
      const user = await registerAndLogin('user3@sessions.test', 'User 3');

      // Login second time
      const login2 = await request(app).post('/api/v1/auth/login').send({
        email: 'user3@sessions.test',
        password: 'SafePassword123!',
      });
      const token2 = login2.body.accessToken;

      // Get sessions list
      const listRes = await request(app)
        .get('/api/v1/sessions')
        .set('Authorization', `Bearer ${user.token}`);
      const session2 = listRes.body.sessions.find(
        (s: { id: string; isCurrent: boolean }) => !s.isCurrent, // session from login2
      );

      // Revoke session 2 using token 1
      const revokeRes = await request(app)
        .delete(`/api/v1/sessions/${session2.id}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.message).toContain('revoked successfully');

      // Verify token2 fails immediately (instant revocation via Redis + DB)
      const testRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token2}`);
      expect(testRes.status).toBe(401);
      expect(testRes.body.error.message).toContain('Session has expired or been revoked');

      // Verify audit log exists
      const auditLog = await testPrisma.auditLog.findFirst({
        where: {
          action: 'session.revoke_own',
          targetId: session2.id,
          actorId: user.user.id,
        },
      });
      expect(auditLog).not.toBeNull();
    });

    it('cannot revoke another user session via own-session endpoint (returns 404)', async () => {
      const user1 = await registerAndLogin('user4@sessions.test', 'User 4');
      const user2 = await registerAndLogin('user5@sessions.test', 'User 5');

      const user2Sessions = await testPrisma.session.findMany({
        where: { userId: user2.user.id },
      });
      const user2SessionId = user2Sessions[0].id;

      // User 1 tries to revoke User 2's session
      const res = await request(app)
        .delete(`/api/v1/sessions/${user2SessionId}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');

      // Verify User 2's session is still active
      const stillActive = await testPrisma.session.findUnique({
        where: { id: user2SessionId },
      });
      expect(stillActive!.revokedAt).toBeNull();
    });

    it('returns 404 for non-existent session ID', async () => {
      const user = await registerAndLogin('user6@sessions.test', 'User 6');

      const res = await request(app)
        .delete('/api/v1/sessions/123e4567-e89b-12d3-a456-426614174000')
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/v1/orgs/:orgId/members/:userId/revoke-sessions (Admin Revocation)', () => {
    it('allows owner to revoke all active sessions of an admin', async () => {
      const { owner, admin, orgId } = await setupOrgWithUsers();

      // Admin has an active session from registerAndLogin
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/members/${admin.user.id}/revoke-sessions`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('revoked successfully');
      expect(res.body.revokedCount).toBeGreaterThanOrEqual(1);

      // Admin access token should now be rejected immediately
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(meRes.status).toBe(401);
      expect(meRes.body.error.message).toContain('Session has expired or been revoked');

      // Verify transactional audit log in org
      const auditLog = await testPrisma.auditLog.findFirst({
        where: {
          orgId,
          action: 'member.sessions_revoke',
          actorId: owner.user.id,
        },
      });
      expect(auditLog).not.toBeNull();
      expect((auditLog!.metadata as Record<string, unknown>).targetUserId).toBe(admin.user.id);
    });

    it('allows admin to revoke sessions of a member (strictly lower priority)', async () => {
      const { admin, member, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/members/${member.user.id}/revoke-sessions`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.revokedCount).toBeGreaterThanOrEqual(1);

      // Member token immediately invalidated
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${member.token}`);
      expect(meRes.status).toBe(401);
    });

    it('rejects admin trying to revoke another admin sessions (equal priority -> 403 Forbidden)', async () => {
      const { admin, orgId, roles } = await setupOrgWithUsers();
      const adminRole = roles.find((r) => r.name === 'admin')!;

      // Create a second admin
      const admin2 = await registerAndLogin('admin2@sessions.test', 'Admin 2');
      await testPrisma.membership.create({
        data: {
          userId: admin2.user.id,
          orgId,
          roleId: adminRole.id,
          status: 'ACTIVE',
        },
      });

      // Admin 1 attempts to revoke Admin 2
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/members/${admin2.user.id}/revoke-sessions`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('equal or higher priority');
    });

    it('rejects admin trying to revoke owner sessions (higher priority -> 403 Forbidden)', async () => {
      const { owner, admin, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/members/${owner.user.id}/revoke-sessions`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects caller lacking session:revoke permission (member -> 403 Forbidden)', async () => {
      const { member, viewer, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/members/${viewer.user.id}/revoke-sessions`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 for non-members to prevent tenant enumeration', async () => {
      const { outsider, member, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/members/${member.user.id}/revoke-sessions`)
        .set('Authorization', `Bearer ${outsider.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 if target member does not exist in the org', async () => {
      const { owner, outsider, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/members/${outsider.user.id}/revoke-sessions`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
