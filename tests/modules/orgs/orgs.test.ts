import request from 'supertest';
import { app } from '../../../src/app';
import { orgsService } from '../../../src/modules/orgs/orgs.service';
import { disconnectDatabase, resetDatabase, testPrisma } from '../../helpers/db';

describe('Organizations Module', () => {
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
      password: 'StrongPassword123!',
    });

    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email,
      password: 'StrongPassword123!',
    });

    return {
      token: loginRes.body.accessToken,
      user: loginRes.body.user,
    };
  }

  describe('POST /api/v1/orgs (Creation & Transaction)', () => {
    it('should create an organization with 4 system roles, permissions, and owner membership atomically', async () => {
      const { token } = await registerAndLogin('owner@example.com', 'Org Owner');

      const res = await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme Corp' });

      expect(res.status).toBe(201);
      expect(res.body.organization).toBeDefined();
      expect(res.body.organization.name).toBe('Acme Corp');
      expect(res.body.organization.slug).toBe('acme-corp');

      const orgId = res.body.organization.id;

      // Verify 4 system roles created
      const roles = await testPrisma.role.findMany({
        where: { orgId },
        include: {
          rolePermissions: {
            include: { permission: true },
          },
        },
      });

      expect(roles).toHaveLength(4);
      const ownerRole = roles.find((r) => r.name === 'owner');
      const adminRole = roles.find((r) => r.name === 'admin');
      const memberRole = roles.find((r) => r.name === 'member');
      const viewerRole = roles.find((r) => r.name === 'viewer');

      expect(ownerRole).toBeDefined();
      expect(ownerRole?.isSystem).toBe(true);
      expect(ownerRole?.priority).toBe(100);
      expect(ownerRole?.rolePermissions).toHaveLength(14); // All permissions

      expect(adminRole).toBeDefined();
      expect(adminRole?.priority).toBe(80);
      expect(adminRole?.rolePermissions).toHaveLength(12); // All except role:manage and org:update

      expect(memberRole).toBeDefined();
      expect(memberRole?.priority).toBe(50);
      expect(memberRole?.rolePermissions).toHaveLength(5);

      expect(viewerRole).toBeDefined();
      expect(viewerRole?.priority).toBe(10);
      expect(viewerRole?.rolePermissions).toHaveLength(3);

      // Verify creator has owner membership
      const memberships = await testPrisma.membership.findMany({
        where: { orgId },
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].roleId).toBe(ownerRole!.id);
      expect(memberships[0].status).toBe('ACTIVE');
    });

    it('should handle slug collisions by appending a counter', async () => {
      const { token } = await registerAndLogin('user1@example.com', 'User 1');

      // 1st org with name 'Acme Corp' -> slug: acme-corp
      const res1 = await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme Corp' });
      expect(res1.body.organization.slug).toBe('acme-corp');

      // 2nd org with same name -> slug: acme-corp-1
      const res2 = await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme Corp' });
      expect(res2.body.organization.slug).toBe('acme-corp-1');

      // 3rd org with same name -> slug: acme-corp-2
      const res3 = await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme Corp' });
      expect(res3.body.organization.slug).toBe('acme-corp-2');
    });

    it('should rollback transaction and persist no partial data when a step fails', async () => {
      const { user } = await registerAndLogin('rollback@example.com', 'Rollback User');

      // Simulate a failure inside the transaction
      await expect(
        orgsService.createOrg(user.id, { name: 'Failed Org' }, async () => {
          throw new Error('Simulated failure during transaction');
        }),
      ).rejects.toThrow('Simulated failure during transaction');

      // Verify no org or roles or memberships were created
      const org = await testPrisma.organization.findFirst({
        where: { name: 'Failed Org' },
      });
      expect(org).toBeNull();

      const roles = await testPrisma.role.findMany({
        where: { org: { name: 'Failed Org' } },
      });
      expect(roles).toHaveLength(0);

      const memberships = await testPrisma.membership.findMany({
        where: { user: { id: user.id } },
      });
      expect(memberships).toHaveLength(0);
    });
  });

  describe('Scoped Access & Leak Protection', () => {
    it('should return 404 (not 403) when a non-member accesses GET /orgs/:orgId', async () => {
      const userA = await registerAndLogin('usera@example.com', 'User A');
      const userB = await registerAndLogin('userb@example.com', 'User B');

      // User A creates an org
      const createRes = await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ name: 'Secret Org' });
      const orgId = createRes.body.organization.id;

      // User B (non-member) requests User A's org
      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}`)
        .set('Authorization', `Bearer ${userB.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toBe('Organization not found');
    });

    it('should return 200 when a member accesses GET /orgs/:orgId', async () => {
      const { token } = await registerAndLogin('member@example.com', 'Member User');

      const createRes = await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Valid Org' });
      const orgId = createRes.body.organization.id;

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.organization.name).toBe('Valid Org');
      expect(res.body.organization.role).toBe('owner');
    });

    it('should return 404 when a non-member tries to update PATCH /orgs/:orgId', async () => {
      const userA = await registerAndLogin('owner1@example.com', 'Owner 1');
      const userB = await registerAndLogin('nonmember@example.com', 'Non Member');

      const createRes = await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ name: 'Original Name' });
      const orgId = createRes.body.organization.id;

      const res = await request(app)
        .patch(`/api/v1/orgs/${orgId}`)
        .set('Authorization', `Bearer ${userB.token}`)
        .send({ name: 'Hacked Name' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('should allow owner to update organization name on PATCH /orgs/:orgId', async () => {
      const { token } = await registerAndLogin('orgowner@example.com', 'Org Owner');

      const createRes = await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Initial Name' });
      const orgId = createRes.body.organization.id;

      const updateRes = await request(app)
        .patch(`/api/v1/orgs/${orgId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Company Name' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.organization.name).toBe('Updated Company Name');
    });

    it('should return all organizations caller belongs to on GET /orgs', async () => {
      const { token } = await registerAndLogin('multi@example.com', 'Multi Org User');

      await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Org One' });

      await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Org Two' });

      const listRes = await request(app)
        .get('/api/v1/orgs')
        .set('Authorization', `Bearer ${token}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.organizations).toHaveLength(2);
    });
  });
});
