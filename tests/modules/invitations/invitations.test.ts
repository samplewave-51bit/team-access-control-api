import crypto from 'crypto';
import request from 'supertest';
import { app } from '../../../src/app';
import { disconnectDatabase, resetDatabase, testPrisma } from '../../helpers/db';

describe('Invitations Module', () => {
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
    const owner = await registerAndLogin('owner@invites.test', 'Owner User');
    const admin = await registerAndLogin('admin@invites.test', 'Admin User');
    const member = await registerAndLogin('member@invites.test', 'Member User');
    const outsider = await registerAndLogin('outsider@invites.test', 'Outsider User');

    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Invitations Org' });
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

    return {
      owner,
      admin,
      member,
      outsider,
      orgId,
      adminRole,
      memberRole,
      viewerRole,
    };
  }

  describe('POST /api/v1/orgs/:orgId/invitations (Create Invitation)', () => {
    it('should create an invitation with a secure 32-byte token and return one-time inviteUrl', async () => {
      const { owner, orgId, memberRole } = await setupOrgWithUsers();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          email: 'newuser@invites.test',
          roleId: memberRole.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.invitation).toBeDefined();
      expect(res.body.invitation.email).toBe('newuser@invites.test');
      expect(res.body.invitation.inviteUrl).toContain('/accept-invite?token=');

      // Extract token from inviteUrl
      const url = new URL(res.body.invitation.inviteUrl);
      const rawToken = url.searchParams.get('token');
      expect(rawToken).toBeTruthy();
      expect(rawToken!.length).toBe(64); // 32 bytes in hex = 64 hex chars

      // Verify DB stored hash, not raw token
      const dbInvite = await testPrisma.invitation.findUnique({
        where: { id: res.body.invitation.id },
      });
      expect(dbInvite).not.toBeNull();
      const expectedHash = crypto.createHash('sha256').update(rawToken!).digest('hex');
      expect(dbInvite!.tokenHash).toBe(expectedHash);
      expect(dbInvite!.tokenHash).not.toBe(rawToken);

      // Verify expiration is ~7 days in future
      const diffDays =
        (new Date(dbInvite!.expiresAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
      expect(Math.round(diffDays)).toBe(7);
    });

    it('should reject duplicate pending invitation to the same email (409 Conflict)', async () => {
      const { owner, orgId, memberRole } = await setupOrgWithUsers();

      await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          email: 'duplicate@invites.test',
          roleId: memberRole.id,
        });

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          email: 'duplicate@invites.test',
          roleId: memberRole.id,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.message).toContain(
        'A pending invitation already exists for this email',
      );
    });

    it('should reject inviting someone who is already an active member (409 Conflict)', async () => {
      const { owner, member, orgId, memberRole } = await setupOrgWithUsers();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          email: member.user.email,
          roleId: memberRole.id,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.message).toContain('User is already a member of this organization');
    });

    it('should reject inviting as owner role (§3 Rule 3)', async () => {
      const { owner, orgId } = await setupOrgWithUsers();
      const roles = await testPrisma.role.findMany({ where: { orgId } });
      const ownerRole = roles.find((r) => r.name === 'owner')!;

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          email: 'futureowner@invites.test',
          roleId: ownerRole.id,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('Cannot invite members as owner');
    });

    it('should reject inviting with a role priority higher than caller own priority', async () => {
      const { owner, admin, orgId } = await setupOrgWithUsers();

      // Create a role with priority 85 (higher than admin's 80)
      const roleRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/roles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'super_lead',
          priority: 85,
          permissions: ['member:read'],
        });
      const highRoleId = roleRes.body.role.id;

      // Admin attempts to invite with priority 85
      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          email: 'highpriority@invites.test',
          roleId: highRoleId,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain(
        'Cannot invite members with a role priority higher than your own',
      );
    });

    it('should reject caller without member:invite permission', async () => {
      const { member, orgId, memberRole } = await setupOrgWithUsers();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({
          email: 'random@invites.test',
          roleId: memberRole.id,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should return 404 for non-members (tenant leak protection)', async () => {
      const { outsider, orgId, memberRole } = await setupOrgWithUsers();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({
          email: 'random@invites.test',
          roleId: memberRole.id,
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/v1/orgs/:orgId/invitations (List Invitations)', () => {
    it('should return list of invitations with pagination', async () => {
      const { owner, orgId, memberRole } = await setupOrgWithUsers();

      await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: 'user1@invites.test', roleId: memberRole.id });

      await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: 'user2@invites.test', roleId: memberRole.id });

      const res = await request(app)
        .get(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.invitations).toHaveLength(2);
      expect(res.body.pagination).toBeDefined();
    });
  });

  describe('DELETE /api/v1/orgs/:orgId/invitations/:id (Revoke Invitation)', () => {
    it('should revoke a pending invitation', async () => {
      const { owner, orgId, memberRole } = await setupOrgWithUsers();

      const inviteRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: 'to_revoke@invites.test', roleId: memberRole.id });

      const inviteId = inviteRes.body.invitation.id;

      const deleteRes = await request(app)
        .delete(`/api/v1/orgs/${orgId}/invitations/${inviteId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.message).toContain('revoked successfully');

      const dbInvite = await testPrisma.invitation.findUnique({ where: { id: inviteId } });
      expect(dbInvite!.revokedAt).not.toBeNull();
    });
  });

  describe('POST /api/v1/invitations/accept (Accept Invitation)', () => {
    it('should accept invitation and create membership in a single transaction when email matches', async () => {
      const { owner, orgId, memberRole } = await setupOrgWithUsers();

      const targetUser = await registerAndLogin('accepted@invites.test', 'Accepted User');

      const inviteRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: targetUser.user.email, roleId: memberRole.id });

      const url = new URL(inviteRes.body.invitation.inviteUrl);
      const rawToken = url.searchParams.get('token')!;

      // Target user accepts
      const acceptRes = await request(app)
        .post('/api/v1/invitations/accept')
        .set('Authorization', `Bearer ${targetUser.token}`)
        .send({ token: rawToken });

      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.message).toContain('accepted successfully');
      expect(acceptRes.body.membership).toBeDefined();
      expect(acceptRes.body.membership.roleId).toBe(memberRole.id);

      // Verify membership exists in DB
      const membership = await testPrisma.membership.findUnique({
        where: { userId_orgId: { userId: targetUser.user.id, orgId } },
      });
      expect(membership).not.toBeNull();
      expect(membership!.roleId).toBe(memberRole.id);

      // Verify invitation is marked accepted
      const dbInvite = await testPrisma.invitation.findUnique({
        where: { id: inviteRes.body.invitation.id },
      });
      expect(dbInvite!.acceptedAt).not.toBeNull();
    });

    it('should reject when logged-in user email does not match invitation email (403 Forbidden)', async () => {
      const { owner, orgId, memberRole } = await setupOrgWithUsers();

      const inviteRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: 'intended@invites.test', roleId: memberRole.id });

      const url = new URL(inviteRes.body.invitation.inviteUrl);
      const rawToken = url.searchParams.get('token')!;

      // Different user tries to accept
      const wrongUser = await registerAndLogin('imposter@invites.test', 'Imposter User');

      const acceptRes = await request(app)
        .post('/api/v1/invitations/accept')
        .set('Authorization', `Bearer ${wrongUser.token}`)
        .send({ token: rawToken });

      expect(acceptRes.status).toBe(403);
      expect(acceptRes.body.error.code).toBe('FORBIDDEN');
      expect(acceptRes.body.error.message).toContain(
        'Invitation was issued for a different email address',
      );
    });

    it('should reject reused token if already accepted (409 Conflict)', async () => {
      const { owner, orgId, memberRole } = await setupOrgWithUsers();

      const targetUser = await registerAndLogin('reused@invites.test', 'Reused User');

      const inviteRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: targetUser.user.email, roleId: memberRole.id });

      const url = new URL(inviteRes.body.invitation.inviteUrl);
      const rawToken = url.searchParams.get('token')!;

      // First acceptance
      await request(app)
        .post('/api/v1/invitations/accept')
        .set('Authorization', `Bearer ${targetUser.token}`)
        .send({ token: rawToken });

      // Second acceptance (token reuse)
      const secondRes = await request(app)
        .post('/api/v1/invitations/accept')
        .set('Authorization', `Bearer ${targetUser.token}`)
        .send({ token: rawToken });

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.error.code).toBe('CONFLICT');
      expect(secondRes.body.error.message).toContain('Invitation has already been accepted');
    });

    it('should reject revoked invitation (409 Conflict)', async () => {
      const { owner, orgId, memberRole } = await setupOrgWithUsers();

      const targetUser = await registerAndLogin('revoked@invites.test', 'Revoked User');

      const inviteRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: targetUser.user.email, roleId: memberRole.id });

      const url = new URL(inviteRes.body.invitation.inviteUrl);
      const rawToken = url.searchParams.get('token')!;
      const inviteId = inviteRes.body.invitation.id;

      // Owner revokes invite
      await request(app)
        .delete(`/api/v1/orgs/${orgId}/invitations/${inviteId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      // User tries to accept
      const acceptRes = await request(app)
        .post('/api/v1/invitations/accept')
        .set('Authorization', `Bearer ${targetUser.token}`)
        .send({ token: rawToken });

      expect(acceptRes.status).toBe(409);
      expect(acceptRes.body.error.code).toBe('CONFLICT');
      expect(acceptRes.body.error.message).toContain('Invitation has been revoked');
    });

    it('should reject expired invitation (409 Conflict)', async () => {
      const { owner, orgId, memberRole } = await setupOrgWithUsers();

      const targetUser = await registerAndLogin('expired@invites.test', 'Expired User');

      const inviteRes = await request(app)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: targetUser.user.email, roleId: memberRole.id });

      const url = new URL(inviteRes.body.invitation.inviteUrl);
      const rawToken = url.searchParams.get('token')!;
      const inviteId = inviteRes.body.invitation.id;

      // Manually set expiresAt to the past in DB
      await testPrisma.invitation.update({
        where: { id: inviteId },
        data: { expiresAt: new Date(Date.now() - 1000 * 60) },
      });

      // User tries to accept
      const acceptRes = await request(app)
        .post('/api/v1/invitations/accept')
        .set('Authorization', `Bearer ${targetUser.token}`)
        .send({ token: rawToken });

      expect(acceptRes.status).toBe(409);
      expect(acceptRes.body.error.code).toBe('CONFLICT');
      expect(acceptRes.body.error.message).toContain('Invitation has expired');
    });

    it('should return 404 for non-existent / invalid token', async () => {
      const targetUser = await registerAndLogin('anyone@invites.test', 'Anyone User');

      const acceptRes = await request(app)
        .post('/api/v1/invitations/accept')
        .set('Authorization', `Bearer ${targetUser.token}`)
        .send({ token: 'completely_invalid_token_value_that_does_not_exist' });

      expect(acceptRes.status).toBe(404);
      expect(acceptRes.body.error.code).toBe('NOT_FOUND');
    });
  });
});
