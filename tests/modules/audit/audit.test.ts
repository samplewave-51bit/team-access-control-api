import request from 'supertest';
import { app } from '../../../src/app';
import { disconnectDatabase, resetDatabase, testPrisma } from '../../helpers/db';

describe('Audit Logs Module', () => {
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
    const owner = await registerAndLogin('owner@audit.test', 'Owner User');
    const admin = await registerAndLogin('admin@audit.test', 'Admin User');
    const member = await registerAndLogin('member@audit.test', 'Member User');
    const viewer = await registerAndLogin('viewer@audit.test', 'Viewer User');
    const outsider = await registerAndLogin('outsider@audit.test', 'Outsider User');

    // Owner creates org (this creates org.created audit log!)
    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Audit Test Org' });
    const orgId = orgRes.body.organization.id;

    // Fetch default roles
    const roles = await testPrisma.role.findMany({ where: { orgId } });
    const adminRole = roles.find((r) => r.name === 'admin')!;
    const memberRole = roles.find((r) => r.name === 'member')!;
    const viewerRole = roles.find((r) => r.name === 'viewer')!;

    // Create memberships
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

  describe('GET /api/v1/orgs/:orgId/audit-logs authorization', () => {
    it('allows owner (audit:read) to view audit logs', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/audit-logs`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('auditLogs');
      expect(res.body).toHaveProperty('pagination');
      expect(Array.isArray(res.body.auditLogs)).toBe(true);
      expect(res.body.auditLogs.length).toBeGreaterThanOrEqual(1);
    });

    it('allows admin (audit:read) to view audit logs', async () => {
      const { admin, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/audit-logs`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('auditLogs');
      expect(res.body).toHaveProperty('pagination');
    });

    it('returns 403 Forbidden for member (lacks audit:read)', async () => {
      const { member, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/audit-logs`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 403 Forbidden for viewer (lacks audit:read)', async () => {
      const { viewer, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/audit-logs`)
        .set('Authorization', `Bearer ${viewer.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 Not Found for outsider to prevent tenant enumeration', async () => {
      const { outsider, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/audit-logs`)
        .set('Authorization', `Bearer ${outsider.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 401 Unauthorized when unauthenticated', async () => {
      const { orgId } = await setupOrgWithUsers();

      const res = await request(app).get(`/api/v1/orgs/${orgId}/audit-logs`);

      expect(res.status).toBe(401);
    });
  });

  describe('Transactional audit log generation on operations', () => {
    it('creates an audit log entry on org creation', async () => {
      const owner = await registerAndLogin('creator@test.com', 'Creator');

      const orgRes = await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Logged Org' });
      const orgId = orgRes.body.organization.id;

      const logs = await testPrisma.auditLog.findMany({
        where: { orgId, action: 'org.create' },
      });

      expect(logs).toHaveLength(1);
      expect(logs[0].actorId).toBe(owner.user.id);
      expect(logs[0].targetType).toBe('Organization');
      expect(logs[0].targetId).toBe(orgId);
      expect((logs[0].metadata as Record<string, unknown>).name).toBe('Logged Org');
    });

    it('creates an audit log entry on member role update', async () => {
      const { owner, admin, orgId, roles } = await setupOrgWithUsers();
      const viewerRole = roles.find((r) => r.name === 'viewer')!;

      const updateRes = await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/${admin.user.id}/role`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ roleId: viewerRole.id });

      expect(updateRes.status).toBe(200);

      const logs = await testPrisma.auditLog.findMany({
        where: { orgId, action: 'member.role_update' },
      });

      expect(logs).toHaveLength(1);
      expect(logs[0].actorId).toBe(owner.user.id);
      expect(logs[0].targetType).toBe('Membership');
      expect((logs[0].metadata as Record<string, unknown>).targetUserId).toBe(admin.user.id);
      expect((logs[0].metadata as Record<string, unknown>).newRoleId).toBe(viewerRole.id);
    });

    it('creates an audit log entry on member removal', async () => {
      const { owner, member, orgId } = await setupOrgWithUsers();

      const deleteRes = await request(app)
        .delete(`/api/v1/orgs/${orgId}/members/${member.user.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(deleteRes.status).toBe(200);

      const logs = await testPrisma.auditLog.findMany({
        where: { orgId, action: 'member.remove' },
      });

      expect(logs).toHaveLength(1);
      expect(logs[0].actorId).toBe(owner.user.id);
      expect(logs[0].targetType).toBe('Membership');
      expect((logs[0].metadata as Record<string, unknown>).targetUserId).toBe(member.user.id);
    });

    it('creates audit log entries on role creation, update, and deletion', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      // Create role
      const createRoleRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'reviewer',
          priority: 40,
          permissions: ['member:read'],
        });
      expect(createRoleRes.status).toBe(201);
      const roleId = createRoleRes.body.role.id;

      // Update role
      const updateRoleRes = await request(app)
        .patch(`/api/v1/orgs/${orgId}/roles/${roleId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          priority: 45,
        });
      expect(updateRoleRes.status).toBe(200);

      // Delete role
      const deleteRoleRes = await request(app)
        .delete(`/api/v1/orgs/${orgId}/roles/${roleId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(deleteRoleRes.status).toBe(200);

      const logs = await testPrisma.auditLog.findMany({
        where: { orgId, targetType: 'Role' },
        orderBy: { createdAt: 'asc' },
      });

      const actions = logs.map((l) => l.action);
      expect(actions).toContain('role.create');
      expect(actions).toContain('role.update');
      expect(actions).toContain('role.delete');
    });

    it('creates audit log entries on invitation creation, revocation, and acceptance', async () => {
      const { owner, orgId, roles } = await setupOrgWithUsers();
      const memberRole = roles.find((r) => r.name === 'member')!;

      // 1. Create invitation
      const inviteRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          email: 'newinvitee@test.com',
          roleId: memberRole.id,
        });
      expect(inviteRes.status).toBe(201);
      const inviteUrl = new URL(inviteRes.body.invitation.inviteUrl);
      const inviteToken = inviteUrl.searchParams.get('token')!;

      // 2. Accept invitation
      const invitee = await registerAndLogin('newinvitee@test.com', 'New Invitee');
      const acceptRes = await request(app)
        .post('/api/v1/invitations/accept')
        .set('Authorization', `Bearer ${invitee.token}`)
        .send({ token: inviteToken });
      expect(acceptRes.status).toBe(200);

      // 3. Create another invitation to revoke
      const invite2Res = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          email: 'revokee@test.com',
          roleId: memberRole.id,
        });
      expect(invite2Res.status).toBe(201);
      const invite2Id = invite2Res.body.invitation.id;

      // Revoke it
      const revokeRes = await request(app)
        .delete(`/api/v1/orgs/${orgId}/invitations/${invite2Id}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(revokeRes.status).toBe(200);

      const inviteLogs = await testPrisma.auditLog.findMany({
        where: { orgId, targetType: 'Invitation' },
      });

      const inviteActions = inviteLogs.map((l) => l.action);
      expect(inviteActions).toContain('invitation.create');
      expect(inviteActions).toContain('invitation.accept');
      expect(inviteActions).toContain('invitation.revoke');
    });

    it('creates audit logs for auth events (login_success, login_failure, logout_all)', async () => {
      // Login failure
      await request(app).post('/api/v1/auth/login').send({
        email: 'fail@test.com',
        password: 'WrongPassword123!',
      });

      const failLogs = await testPrisma.auditLog.findMany({
        where: { action: 'auth.login_failure' },
      });
      expect(failLogs.length).toBeGreaterThanOrEqual(1);
      expect((failLogs[0].metadata as Record<string, unknown>).email).toBe('fail@test.com');

      // Register and login success
      const user = await registerAndLogin('successtest@test.com', 'Success User');
      const successLogs = await testPrisma.auditLog.findMany({
        where: { action: 'auth.login_success', actorId: user.user.id },
      });
      expect(successLogs).toHaveLength(1);

      // Logout all
      await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${user.token}`);

      const logoutAllLogs = await testPrisma.auditLog.findMany({
        where: { action: 'auth.logout_all', actorId: user.user.id },
      });
      expect(logoutAllLogs).toHaveLength(1);
    });

    it('rolls back audit log if transaction fails', async () => {
      const { orgId } = await setupOrgWithUsers();

      // Simulate a failed transaction using testPrisma.$transaction
      try {
        await testPrisma.$transaction(async (tx) => {
          await tx.auditLog.create({
            data: {
              orgId,
              action: 'transaction.test',
              targetType: 'Test',
            },
          });
          throw new Error('Simulated failure');
        });
      } catch {
        // expected error
      }

      const log = await testPrisma.auditLog.findFirst({
        where: { orgId, action: 'transaction.test' },
      });
      expect(log).toBeNull();
    });
  });

  describe('Filtering and pagination in GET /api/v1/orgs/:orgId/audit-logs', () => {
    it('filters audit logs by action and actorId', async () => {
      const { owner, member, orgId, roles } = await setupOrgWithUsers();
      const adminRole = roles.find((r) => r.name === 'admin')!;

      // Perform a member role update
      await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/${member.user.id}/role`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ roleId: adminRole.id });

      // Filter by action: member.role_update
      const resAction = await request(app)
        .get(`/api/v1/orgs/${orgId}/audit-logs?action=member.role_update`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(resAction.status).toBe(200);
      expect(resAction.body.auditLogs.length).toBe(1);
      expect(resAction.body.auditLogs[0].action).toBe('member.role_update');

      // Filter by actorId: owner.user.id
      const resActor = await request(app)
        .get(`/api/v1/orgs/${orgId}/audit-logs?actorId=${owner.user.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(resActor.status).toBe(200);
      expect(
        resActor.body.auditLogs.every(
          (l: { actorId: string | null }) => l.actorId === owner.user.id,
        ),
      ).toBe(true);

      // Filter by non-existent action
      const resNone = await request(app)
        .get(`/api/v1/orgs/${orgId}/audit-logs?action=non_existent_action`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(resNone.status).toBe(200);
      expect(resNone.body.auditLogs).toHaveLength(0);
    });

    it('paginates audit logs with cursor and limit', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      // Seed 5 custom audit log entries directly
      for (let i = 1; i <= 5; i++) {
        await testPrisma.auditLog.create({
          data: {
            orgId,
            actorId: owner.user.id,
            action: `test.batch_${i}`,
            targetType: 'Batch',
            createdAt: new Date(Date.now() + i * 1000),
          },
        });
      }

      // Query page 1 with limit 2
      const page1 = await request(app)
        .get(`/api/v1/orgs/${orgId}/audit-logs?limit=2`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(page1.status).toBe(200);
      expect(page1.body.auditLogs).toHaveLength(2);
      expect(page1.body.pagination.hasNextPage).toBe(true);
      expect(page1.body.pagination.nextCursor).toBeDefined();

      const nextCursor = page1.body.pagination.nextCursor;

      // Query page 2 with cursor
      const page2 = await request(app)
        .get(`/api/v1/orgs/${orgId}/audit-logs?limit=2&cursor=${nextCursor}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(page2.status).toBe(200);
      expect(page2.body.auditLogs).toHaveLength(2);
      // Items on page 2 should be distinct from page 1
      const page1Ids = page1.body.auditLogs.map((l: { id: string }) => l.id);
      const page2Ids = page2.body.auditLogs.map((l: { id: string }) => l.id);
      expect(page1Ids).not.toContain(page2Ids[0]);
    });
  });
});
