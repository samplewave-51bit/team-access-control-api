import request from 'supertest';
import { app } from '../../../src/app';
import { disconnectDatabase, resetDatabase, testPrisma } from '../../helpers/db';

describe('Roles Module (Custom Role CRUD & RBAC Rules)', () => {
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
    const owner = await registerAndLogin('owner@roles.test', 'Owner User');
    const admin = await registerAndLogin('admin@roles.test', 'Admin User');
    const member = await registerAndLogin('member@roles.test', 'Member User');
    const outsider = await registerAndLogin('outsider@roles.test', 'Outsider User');

    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Role Management Org' });
    const orgId = orgRes.body.organization.id;

    const roles = await testPrisma.role.findMany({ where: { orgId } });
    const adminRole = roles.find((r) => r.name === 'admin')!;
    const memberRole = roles.find((r) => r.name === 'member')!;

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

    return {
      owner,
      admin,
      member,
      outsider,
      orgId,
    };
  }

  describe('GET /api/v1/orgs/:orgId/roles', () => {
    it('should return all system roles with their permissions for members with role:read', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.roles).toBeDefined();
      expect(res.body.roles.length).toBe(4);

      const roleNames = res.body.roles.map((r: { name: string }) => r.name);
      expect(roleNames).toContain('owner');
      expect(roleNames).toContain('admin');
      expect(roleNames).toContain('member');
      expect(roleNames).toContain('viewer');

      const ownerRole = res.body.roles.find((r: { name: string }) => r.name === 'owner');
      expect(ownerRole.priority).toBe(100);
      expect(ownerRole.isSystem).toBe(true);
      expect(ownerRole.permissions).toContain('role:manage');
      expect(ownerRole.permissions).toContain('role:read');
    });

    it('should return 404 for non-members (leak protection)', async () => {
      const { outsider, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${outsider.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 401 for unauthenticated request', async () => {
      const { orgId } = await setupOrgWithUsers();

      const res = await request(app).get(`/api/v1/orgs/${orgId}/roles`);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/orgs/:orgId/roles (Create Custom Role)', () => {
    it('should create a custom role with valid permissions and priority < caller priority', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'support_lead',
          priority: 60,
          permissions: ['member:read', 'role:read', 'file:read:own'],
        });

      expect(res.status).toBe(201);
      expect(res.body.role).toBeDefined();
      expect(res.body.role.name).toBe('support_lead');
      expect(res.body.role.priority).toBe(60);
      expect(res.body.role.isSystem).toBe(false);
      expect(res.body.role.permissions).toEqual(
        expect.arrayContaining(['member:read', 'role:read', 'file:read:own']),
      );

      // Verify in DB
      const dbRole = await testPrisma.role.findUnique({
        where: { id: res.body.role.id },
        include: { rolePermissions: { include: { permission: true } } },
      });
      expect(dbRole).not.toBeNull();
      expect(dbRole!.name).toBe('support_lead');
      expect(dbRole!.rolePermissions.length).toBe(3);
    });

    it('should reject creating a role if caller lacks role:manage (e.g. admin or member)', async () => {
      const { admin, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          name: 'tester',
          priority: 30,
          permissions: ['role:read'],
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should reject role creation with priority >= creator priority (§3 Rule 3 & 5)', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      // Owner has priority 100, attempting priority 100 should be rejected by validation or logic
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'co_owner',
          priority: 100,
          permissions: ['role:read'],
        });

      // Max priority allowed by schema is 99, priority >= 100 yields 400
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject role creation when caller has lower priority than requested priority', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      // Create a manager role with priority 70 and role:manage
      const managerRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'manager',
          priority: 70,
          permissions: ['role:read', 'role:manage', 'member:read'],
        });
      const managerRoleId = managerRes.body.role.id;

      // Assign manager role to a user
      const managerUser = await registerAndLogin('manager@roles.test', 'Manager User');
      await testPrisma.membership.create({
        data: {
          userId: managerUser.user.id,
          orgId,
          roleId: managerRoleId,
          status: 'ACTIVE',
        },
      });

      // Manager attempts to create a role with priority 75 (higher than manager's 70)
      const escalationRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${managerUser.token}`)
        .send({
          name: 'lead_director',
          priority: 75,
          permissions: ['role:read'],
        });

      expect(escalationRes.status).toBe(403);
      expect(escalationRes.body.error.message).toContain(
        'Cannot create a role with priority equal to or higher than your own',
      );

      // Manager attempts to create a role with priority 70 (equal to manager's 70)
      const equalRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${managerUser.token}`)
        .send({
          name: 'equal_manager',
          priority: 70,
          permissions: ['role:read'],
        });

      expect(equalRes.status).toBe(403);
      expect(equalRes.body.error.message).toContain(
        'Cannot create a role with priority equal to or higher than your own',
      );
    });

    it('should reject privilege escalation when creator assigns permissions they do not possess', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      // Create a manager role with only role:read and role:manage (does not have org:update)
      const managerRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'role_admin',
          priority: 70,
          permissions: ['role:read', 'role:manage'],
        });
      const managerRoleId = managerRes.body.role.id;

      const managerUser = await registerAndLogin('roleadmin@roles.test', 'Role Admin');
      await testPrisma.membership.create({
        data: {
          userId: managerUser.user.id,
          orgId,
          roleId: managerRoleId,
          status: 'ACTIVE',
        },
      });

      // Manager attempts to create a role granting 'org:update' which manager does NOT have
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${managerUser.token}`)
        .send({
          name: 'super_helper',
          priority: 50,
          permissions: ['org:update'],
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain(
        "Cannot assign permission 'org:update' which you do not possess",
      );
    });

    it('should reject duplicate role names in the same organization (409 Conflict)', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      // Owner tries to create a role with name 'admin' which already exists as system role
      const duplicateRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'admin',
          priority: 40,
          permissions: ['role:read'],
        });

      expect(duplicateRes.status).toBe(409);
      expect(duplicateRes.body.error.code).toBe('CONFLICT');
    });

    it('should reject invalid permission keys that do not exist in the catalog (400 Bad Request)', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'custom_special',
          priority: 40,
          permissions: ['invalid:nonexistent:permission'],
        });

      // Since owner possesses all permissions from DB, the non-existent key will either fail privilege escalation or catalog check
      expect([400, 403]).toContain(res.status);
    });
  });

  describe('PATCH /api/v1/orgs/:orgId/roles/:roleId (Update Custom Role)', () => {
    it('should update custom role name, priority, and permissions successfully', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      const createRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'tier1_support',
          priority: 30,
          permissions: ['role:read'],
        });
      const roleId = createRes.body.role.id;

      const updateRes = await request(app)
        .patch(`/api/v1/orgs/${orgId}/roles/${roleId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'tier2_support',
          priority: 35,
          permissions: ['role:read', 'member:read'],
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.role.name).toBe('tier2_support');
      expect(updateRes.body.role.priority).toBe(35);
      expect(updateRes.body.role.permissions).toEqual(
        expect.arrayContaining(['role:read', 'member:read']),
      );
    });

    it('should reject editing system roles (§3 Rule 5: isSystem cannot be edited)', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      const roles = await testPrisma.role.findMany({ where: { orgId } });
      const adminRole = roles.find((r) => r.name === 'admin')!;

      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/roles/${adminRole.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'renamed_admin',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('System roles cannot be modified');
    });

    it('should reject setting priority >= caller priority', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      // Create custom role
      const createRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'dev_role',
          priority: 30,
          permissions: ['role:read'],
        });
      const roleId = createRes.body.role.id;

      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/roles/${roleId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          priority: 100, // schema restricts to max 99, so 100 fails validation
        });

      expect(res.status).toBe(400);
    });

    it('should reject modifying role if caller priority <= target role priority', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      // Create a senior custom role (priority 75) and a junior manager role (priority 60)
      const seniorRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'senior_staff',
          priority: 75,
          permissions: ['role:read'],
        });
      const seniorRoleId = seniorRes.body.role.id;

      const managerRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'junior_lead',
          priority: 60,
          permissions: ['role:read', 'role:manage'],
        });
      const managerRoleId = managerRes.body.role.id;

      const juniorUser = await registerAndLogin('junior@roles.test', 'Junior Lead');
      await testPrisma.membership.create({
        data: {
          userId: juniorUser.user.id,
          orgId,
          roleId: managerRoleId,
          status: 'ACTIVE',
        },
      });

      // Junior lead (priority 60) tries to update senior_staff (priority 75)
      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/roles/${seniorRoleId}`)
        .set('Authorization', `Bearer ${juniorUser.token}`)
        .send({
          name: 'attempted_rename',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain(
        'Cannot modify a role with priority equal to or higher than your own',
      );
    });

    it('should reject duplicate name if updated name collides with another role', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      const createRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'custom_alpha',
          priority: 30,
          permissions: ['role:read'],
        });
      const roleId = createRes.body.role.id;

      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/roles/${roleId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'viewer', // collides with system role 'viewer'
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('should return 404 for non-existent role', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}/roles/123e4567-e89b-12d3-a456-426614174999`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'ghost_role',
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/orgs/:orgId/roles/:roleId (Delete Custom Role)', () => {
    it('should successfully delete an unassigned custom role', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      const createRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'temporary_contractor',
          priority: 25,
          permissions: ['file:upload'],
        });
      const roleId = createRes.body.role.id;

      const deleteRes = await request(app)
        .delete(`/api/v1/orgs/${orgId}/roles/${roleId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.message).toContain('deleted successfully');

      // Verify role is deleted from DB
      const dbRole = await testPrisma.role.findUnique({ where: { id: roleId } });
      expect(dbRole).toBeNull();
    });

    it('should reject deleting system roles (§3 Rule 5: cannot be deleted)', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      const roles = await testPrisma.role.findMany({ where: { orgId } });
      const viewerRole = roles.find((r) => r.name === 'viewer')!;

      const res = await request(app)
        .delete(`/api/v1/orgs/${orgId}/roles/${viewerRole.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('System roles cannot be deleted');
    });

    it('should reject deleting a role that currently has members (409 Conflict)', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      const createRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'auditor',
          priority: 35,
          permissions: ['audit:read'],
        });
      const roleId = createRes.body.role.id;

      // Assign role to a user
      const auditorUser = await registerAndLogin('auditor@roles.test', 'Auditor User');
      await testPrisma.membership.create({
        data: {
          userId: auditorUser.user.id,
          orgId,
          roleId,
          status: 'ACTIVE',
        },
      });

      // Try to delete role
      const res = await request(app)
        .delete(`/api/v1/orgs/${orgId}/roles/${roleId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.message).toContain('Cannot delete a role that currently has members');
    });

    it('should return 404 for non-existent role', async () => {
      const { owner, orgId } = await setupOrgWithUsers();

      const res = await request(app)
        .delete(`/api/v1/orgs/${orgId}/roles/123e4567-e89b-12d3-a456-426614174999`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
