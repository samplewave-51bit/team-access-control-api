import request from 'supertest';
import { app } from '../../../src/app';
import { disconnectDatabase, resetDatabase, testPrisma } from '../../helpers/db';

describe('RBAC & Members Listing', () => {
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

  async function setupOrgWithFourRoles() {
    const owner = await registerAndLogin('owner@test.com', 'Owner User');
    const admin = await registerAndLogin('admin@test.com', 'Admin User');
    const member = await registerAndLogin('member@test.com', 'Member User');
    const viewer = await registerAndLogin('viewer@test.com', 'Viewer User');
    const outsider = await registerAndLogin('outsider@test.com', 'Outsider User');

    // Owner creates org
    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Role Test Org' });
    const orgId = orgRes.body.organization.id;

    // Fetch roles
    const roles = await testPrisma.role.findMany({ where: { orgId } });
    const adminRole = roles.find((r) => r.name === 'admin')!;
    const memberRole = roles.find((r) => r.name === 'member')!;
    const viewerRole = roles.find((r) => r.name === 'viewer')!;

    // Add admin, member, viewer memberships
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

    return { orgId, owner, admin, member, viewer, outsider };
  }

  describe('GET /api/v1/permissions', () => {
    it('should return the full permission catalog of 14 permissions', async () => {
      const { owner } = await setupOrgWithFourRoles();

      const res = await request(app)
        .get('/api/v1/permissions')
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.permissions).toHaveLength(14);
      expect(res.body.permissions.some((p: { key: string }) => p.key === 'member:read')).toBe(true);
      expect(res.body.permissions.some((p: { key: string }) => p.key === 'org:update')).toBe(true);
    });
  });

  describe('RBAC Matrix: member:read on GET /orgs/:orgId/members', () => {
    it('should allow owner, admin, member, and viewer to list members', async () => {
      const { orgId, owner, admin, member, viewer } = await setupOrgWithFourRoles();

      // Owner has member:read
      const ownerRes = await request(app)
        .get(`/api/v1/orgs/${orgId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(ownerRes.status).toBe(200);
      expect(ownerRes.body.members).toHaveLength(4);

      // Admin has member:read
      const adminRes = await request(app)
        .get(`/api/v1/orgs/${orgId}/members`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(adminRes.status).toBe(200);

      // Member has member:read
      const memberRes = await request(app)
        .get(`/api/v1/orgs/${orgId}/members`)
        .set('Authorization', `Bearer ${member.token}`);
      expect(memberRes.status).toBe(200);

      // Viewer has member:read
      const viewerRes = await request(app)
        .get(`/api/v1/orgs/${orgId}/members`)
        .set('Authorization', `Bearer ${viewer.token}`);
      expect(viewerRes.status).toBe(200);
    });

    it('should return 404 for non-members (leak protection)', async () => {
      const { orgId, outsider } = await setupOrgWithFourRoles();

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/members`)
        .set('Authorization', `Bearer ${outsider.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('RBAC Matrix: org:update on PATCH /orgs/:orgId', () => {
    it('should allow owner (has org:update) and forbid admin, member, viewer (lack org:update)', async () => {
      const { orgId, owner, admin, member, viewer, outsider } = await setupOrgWithFourRoles();

      // Owner has org:update -> 200
      const ownerRes = await request(app)
        .patch(`/api/v1/orgs/${orgId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Owner Updated Name' });
      expect(ownerRes.status).toBe(200);

      // Admin lacks org:update -> 403 Forbidden
      const adminRes = await request(app)
        .patch(`/api/v1/orgs/${orgId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Admin Attempt' });
      expect(adminRes.status).toBe(403);
      expect(adminRes.body.error.code).toBe('FORBIDDEN');

      // Member lacks org:update -> 403 Forbidden
      const memberRes = await request(app)
        .patch(`/api/v1/orgs/${orgId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ name: 'Member Attempt' });
      expect(memberRes.status).toBe(403);
      expect(memberRes.body.error.code).toBe('FORBIDDEN');

      // Viewer lacks org:update -> 403 Forbidden
      const viewerRes = await request(app)
        .patch(`/api/v1/orgs/${orgId}`)
        .set('Authorization', `Bearer ${viewer.token}`)
        .send({ name: 'Viewer Attempt' });
      expect(viewerRes.status).toBe(403);
      expect(viewerRes.body.error.code).toBe('FORBIDDEN');

      // Non-member -> 404 Not Found (leak protection)
      const outsiderRes = await request(app)
        .patch(`/api/v1/orgs/${orgId}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ name: 'Outsider Attempt' });
      expect(outsiderRes.status).toBe(404);
    });
  });

  describe('Cursor Pagination on GET /orgs/:orgId/members', () => {
    it('should correctly paginate members using limit and cursor', async () => {
      const { orgId, owner } = await setupOrgWithFourRoles();

      // Page 1: limit 2
      const page1 = await request(app)
        .get(`/api/v1/orgs/${orgId}/members?limit=2`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(page1.status).toBe(200);
      expect(page1.body.members).toHaveLength(2);
      expect(page1.body.pagination.hasNextPage).toBe(true);
      expect(page1.body.pagination.nextCursor).toBeDefined();

      const nextCursor = page1.body.pagination.nextCursor;

      // Page 2: with cursor
      const page2 = await request(app)
        .get(`/api/v1/orgs/${orgId}/members?limit=2&cursor=${nextCursor}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(page2.status).toBe(200);
      expect(page2.body.members).toHaveLength(2);
      expect(page2.body.pagination.hasNextPage).toBe(false);
      expect(page2.body.pagination.nextCursor).toBeNull();

      // Ensure no duplicate IDs across pages
      const page1Ids = page1.body.members.map((m: { id: string }) => m.id);
      const page2Ids = page2.body.members.map((m: { id: string }) => m.id);
      for (const id of page2Ids) {
        expect(page1Ids).not.toContain(id);
      }
    });
  });
});
