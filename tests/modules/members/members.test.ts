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

  describe('PATCH /api/v1/orgs/:orgId/members/:userId/role (Hierarchy & Last-Owner Rules)', () => {
    it('should allow owner to update an admin role to member', async () => {
      const { orgId, owner, admin } = await setupOrgWithFourRoles();
      const roles = await testPrisma.role.findMany({ where: { orgId } });
      const memberRole = roles.find((r) => r.name === 'member')!;

      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/${admin.user.id}/role`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ roleId: memberRole.id });

      expect(res.status).toBe(200);
      expect(res.body.member.role.name).toBe('member');

      const updated = await testPrisma.membership.findUnique({
        where: { userId_orgId: { userId: admin.user.id, orgId } },
        include: { role: true },
      });
      expect(updated!.role.name).toBe('member');
    });

    it('should allow admin to change member role to viewer (priority strictly lower)', async () => {
      const { orgId, admin, member } = await setupOrgWithFourRoles();
      const roles = await testPrisma.role.findMany({ where: { orgId } });
      const viewerRole = roles.find((r) => r.name === 'viewer')!;

      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/${member.user.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ roleId: viewerRole.id });

      expect(res.status).toBe(200);
      expect(res.body.member.role.name).toBe('viewer');
    });

    it('should reject admin attempting to modify another admin role (equal priority)', async () => {
      const { orgId, admin } = await setupOrgWithFourRoles();
      const roles = await testPrisma.role.findMany({ where: { orgId } });
      const viewerRole = roles.find((r) => r.name === 'viewer')!;
      const adminRole = roles.find((r) => r.name === 'admin')!;

      const secondAdmin = await registerAndLogin('admin2@test.com', 'Admin 2');
      await testPrisma.membership.create({
        data: {
          userId: secondAdmin.user.id,
          orgId,
          roleId: adminRole.id,
          status: 'ACTIVE',
        },
      });

      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/${secondAdmin.user.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ roleId: viewerRole.id });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain(
        'Cannot modify the role of a member with equal or higher priority',
      );
    });

    it('should reject admin attempting to modify owner role (higher priority)', async () => {
      const { orgId, admin, owner } = await setupOrgWithFourRoles();
      const roles = await testPrisma.role.findMany({ where: { orgId } });
      const viewerRole = roles.find((r) => r.name === 'viewer')!;

      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/${owner.user.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ roleId: viewerRole.id });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain(
        'Cannot modify the role of a member with equal or higher priority',
      );
    });

    it('should reject owner attempting to modify another owner role (equal priority)', async () => {
      const { orgId, owner } = await setupOrgWithFourRoles();
      const roles = await testPrisma.role.findMany({ where: { orgId } });
      const ownerRole = roles.find((r) => r.name === 'owner')!;
      const viewerRole = roles.find((r) => r.name === 'viewer')!;

      const secondOwner = await registerAndLogin('owner2@test.com', 'Owner 2');
      await testPrisma.membership.create({
        data: {
          userId: secondOwner.user.id,
          orgId,
          roleId: ownerRole.id,
          status: 'ACTIVE',
        },
      });

      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/${secondOwner.user.id}/role`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ roleId: viewerRole.id });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain(
        'Cannot modify the role of a member with equal or higher priority',
      );
    });

    it('should reject assigning owner role (§3 Rule 3: assigning owner is NOT allowed)', async () => {
      const { orgId, owner, member } = await setupOrgWithFourRoles();
      const roles = await testPrisma.role.findMany({ where: { orgId } });
      const ownerRole = roles.find((r) => r.name === 'owner')!;

      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/${member.user.id}/role`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ roleId: ownerRole.id });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain(
        'Cannot assign owner role; owner assignment is not permitted',
      );
    });

    it('should reject assigning a role with priority higher than caller own priority', async () => {
      const { orgId, owner, admin, member } = await setupOrgWithFourRoles();

      // Create custom role with priority 85 (higher than admin priority 80)
      const highRoleRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'director',
          priority: 85,
          permissions: ['member:read', 'role:read'],
        });
      const highRoleId = highRoleRes.body.role.id;

      // Admin (priority 80) tries to assign highRole (priority 85) to member
      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/${member.user.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ roleId: highRoleId });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain(
        'Cannot assign a role with priority higher than your own',
      );
    });

    it('should reject demoting the last owner of the organization (§3 Rule 4)', async () => {
      const { orgId, owner } = await setupOrgWithFourRoles();
      const roles = await testPrisma.role.findMany({ where: { orgId } });
      const memberRole = roles.find((r) => r.name === 'member')!;

      // Owner attempts to demote themselves
      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/${owner.user.id}/role`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ roleId: memberRole.id });

      expect(res.status).toBe(403);
    });

    it('should return 404 if member does not exist in the organization', async () => {
      const { orgId, owner } = await setupOrgWithFourRoles();
      const roles = await testPrisma.role.findMany({ where: { orgId } });
      const memberRole = roles.find((r) => r.name === 'member')!;

      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/members/123e4567-e89b-12d3-a456-426614174999/role`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ roleId: memberRole.id });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/orgs/:orgId/members/:userId (Member Removal & Last-Owner Protection)', () => {
    it('should allow owner to remove an admin from the organization', async () => {
      const { orgId, owner, admin } = await setupOrgWithFourRoles();

      const res = await request(app)
        .delete(`/api/v1/orgs/${orgId}/members/${admin.user.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Member removed successfully');

      const membership = await testPrisma.membership.findUnique({
        where: { userId_orgId: { userId: admin.user.id, orgId } },
      });
      expect(membership).toBeNull();
    });

    it('should allow admin to remove a member (priority strictly lower)', async () => {
      const { orgId, admin, member } = await setupOrgWithFourRoles();

      const res = await request(app)
        .delete(`/api/v1/orgs/${orgId}/members/${member.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Member removed successfully');
    });

    it('should reject admin trying to remove another admin (equal priority)', async () => {
      const { orgId, admin } = await setupOrgWithFourRoles();
      const roles = await testPrisma.role.findMany({ where: { orgId } });
      const adminRole = roles.find((r) => r.name === 'admin')!;

      const secondAdmin = await registerAndLogin('admin_two@test.com', 'Admin Two');
      await testPrisma.membership.create({
        data: {
          userId: secondAdmin.user.id,
          orgId,
          roleId: adminRole.id,
          status: 'ACTIVE',
        },
      });

      const res = await request(app)
        .delete(`/api/v1/orgs/${orgId}/members/${secondAdmin.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain(
        'Cannot remove a member with equal or higher priority',
      );
    });

    it('should reject admin trying to remove owner (higher priority)', async () => {
      const { orgId, admin, owner } = await setupOrgWithFourRoles();

      const res = await request(app)
        .delete(`/api/v1/orgs/${orgId}/members/${owner.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain(
        'Cannot remove a member with equal or higher priority',
      );
    });

    it('should reject removing the last owner of the organization (§3 Rule 4)', async () => {
      const { orgId, owner } = await setupOrgWithFourRoles();

      const res = await request(app)
        .delete(`/api/v1/orgs/${orgId}/members/${owner.user.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('Cannot remove the last owner of the organization');
    });

    it('should return 404 for removing a non-existent member', async () => {
      const { orgId, owner } = await setupOrgWithFourRoles();

      const res = await request(app)
        .delete(`/api/v1/orgs/${orgId}/members/123e4567-e89b-12d3-a456-426614174999`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Concurrent Demotion & Last Owner Race Protection', () => {
    it('should preserve last-owner invariant under concurrent demotion attempts', async () => {
      const { orgId, owner } = await setupOrgWithFourRoles();
      const roles = await testPrisma.role.findMany({ where: { orgId } });
      const memberRole = roles.find((r) => r.name === 'member')!;

      // Execute concurrent demotion attempts on the last owner
      const results = await Promise.all([
        request(app)
          .patch(`/api/v1/orgs/${orgId}/members/${owner.user.id}/role`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ roleId: memberRole.id }),
        request(app)
          .patch(`/api/v1/orgs/${orgId}/members/${owner.user.id}/role`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ roleId: memberRole.id }),
      ]);

      // Both must be rejected; owner must remain owner
      for (const res of results) {
        expect(res.status).toBe(403);
      }

      const activeOwners = await testPrisma.membership.findMany({
        where: {
          orgId,
          role: { name: 'owner' },
          status: 'ACTIVE',
        },
      });
      expect(activeOwners).toHaveLength(1);
    });
  });
});
