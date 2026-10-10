import crypto from 'crypto';
import { env } from '../../config/env';
import { recordAudit } from '../../lib/audit';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { MembershipWithRoleAndPermissions } from '../../middleware/requirePermission';
import {
  AcceptInvitationInput,
  CreateInvitationInput,
  ListInvitationsQuery,
} from './invitations.schemas';

export class InvitationsService {
  async createInvitation(
    orgId: string,
    caller: MembershipWithRoleAndPermissions,
    callerUserId: string,
    input: CreateInvitationInput,
  ) {
    const role = await prisma.role.findUnique({
      where: { id: input.roleId },
    });

    if (!role || role.orgId !== orgId) {
      throw new NotFoundError('Role not found');
    }

    // §3 Rule 3: Cannot invite as owner (no owner assignment or transfer in v1)
    if (role.name === 'owner' || role.priority >= 100) {
      throw new ForbiddenError('Cannot invite members as owner; owner assignment is not permitted');
    }

    // §3 Rule 3: Cannot invite with role higher than caller's priority
    if (role.priority > caller.role.priority) {
      throw new ForbiddenError('Cannot invite members with a role priority higher than your own');
    }

    // Check if user is already an active member
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existingUser) {
      const existingMembership = await prisma.membership.findUnique({
        where: {
          userId_orgId: {
            userId: existingUser.id,
            orgId,
          },
        },
      });

      if (existingMembership && existingMembership.status === 'ACTIVE') {
        throw new ConflictError('User is already a member of this organization');
      }
    }

    // Check for duplicate pending invitation
    const pendingInvite = await prisma.invitation.findFirst({
      where: {
        orgId,
        email: input.email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (pendingInvite) {
      throw new ConflictError('A pending invitation already exists for this email');
    }

    // Generate 32-byte secure random token and SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days per §10

    const invitation = await prisma.$transaction(async (tx) => {
      const inv = await tx.invitation.create({
        data: {
          orgId,
          email: input.email,
          roleId: input.roleId,
          tokenHash,
          expiresAt,
          invitedById: callerUserId,
        },
        include: {
          role: {
            select: { id: true, name: true, priority: true, isSystem: true },
          },
          invitedBy: {
            select: { id: true, email: true, name: true },
          },
        },
      });

      await recordAudit(tx, {
        orgId,
        actorId: callerUserId,
        action: 'invitation.create',
        targetType: 'Invitation',
        targetId: inv.id,
        metadata: {
          email: input.email,
          roleId: input.roleId,
          roleName: inv.role.name,
        },
      });

      return inv;
    });

    const inviteUrl = `${env.APP_URL}/accept-invite?token=${rawToken}`;

    return {
      invitation: {
        id: invitation.id,
        orgId: invitation.orgId,
        email: invitation.email,
        roleId: invitation.roleId,
        expiresAt: invitation.expiresAt.toISOString(),
        acceptedAt: invitation.acceptedAt ? invitation.acceptedAt.toISOString() : null,
        revokedAt: invitation.revokedAt ? invitation.revokedAt.toISOString() : null,
        invitedById: invitation.invitedById,
        createdAt: invitation.createdAt.toISOString(),
        updatedAt: invitation.updatedAt.toISOString(),
        inviteUrl,
        role: invitation.role,
        invitedBy: invitation.invitedBy,
      },
    };
  }

  async listInvitations(orgId: string, query: ListInvitationsQuery) {
    const limit = query.limit || 20;
    const cursor = query.cursor;

    const whereClause: Record<string, unknown> = { orgId };

    if (query.status === 'pending') {
      whereClause.acceptedAt = null;
      whereClause.revokedAt = null;
      whereClause.expiresAt = { gt: new Date() };
    } else if (query.status === 'accepted') {
      whereClause.acceptedAt = { not: null };
    } else if (query.status === 'revoked') {
      whereClause.revokedAt = { not: null };
    } else if (query.status === 'expired') {
      whereClause.acceptedAt = null;
      whereClause.revokedAt = null;
      whereClause.expiresAt = { lte: new Date() };
    }

    const invitations = await prisma.invitation.findMany({
      where: whereClause,
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        role: {
          select: { id: true, name: true, priority: true, isSystem: true },
        },
        invitedBy: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    const hasNextPage = invitations.length > limit;
    const items = hasNextPage ? invitations.slice(0, limit) : invitations;
    const nextCursor = hasNextPage ? items[items.length - 1].id : null;

    return {
      invitations: items.map((inv) => ({
        id: inv.id,
        orgId: inv.orgId,
        email: inv.email,
        roleId: inv.roleId,
        expiresAt: inv.expiresAt.toISOString(),
        acceptedAt: inv.acceptedAt ? inv.acceptedAt.toISOString() : null,
        revokedAt: inv.revokedAt ? inv.revokedAt.toISOString() : null,
        invitedById: inv.invitedById,
        createdAt: inv.createdAt.toISOString(),
        updatedAt: inv.updatedAt.toISOString(),
        role: inv.role,
        invitedBy: inv.invitedBy,
      })),
      pagination: {
        nextCursor,
        hasNextPage,
      },
    };
  }

  async revokeInvitation(
    orgId: string,
    invitationId: string,
    caller: MembershipWithRoleAndPermissions,
  ) {
    const invitation = await prisma.invitation.findUnique({
      where: { id: invitationId },
      include: { role: true },
    });

    if (!invitation || invitation.orgId !== orgId) {
      throw new NotFoundError('Invitation not found');
    }

    if (invitation.acceptedAt !== null) {
      throw new ConflictError('Cannot revoke an already accepted invitation');
    }

    // Hierarchy rule check: caller cannot revoke invite for role strictly higher than caller
    if (invitation.role.priority > caller.role.priority) {
      throw new ForbiddenError(
        'Cannot revoke an invitation for a role with priority higher than your own',
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitationId },
        data: { revokedAt: new Date() },
      });

      await recordAudit(tx, {
        orgId,
        actorId: caller.userId,
        action: 'invitation.revoke',
        targetType: 'Invitation',
        targetId: invitationId,
        metadata: {
          email: invitation.email,
          roleId: invitation.roleId,
        },
      });
    });

    return {
      message: 'Invitation revoked successfully',
    };
  }

  async acceptInvitation(userId: string, userEmail: string, input: AcceptInvitationInput) {
    const tokenHash = crypto.createHash('sha256').update(input.token).digest('hex');

    const invitation = await prisma.invitation.findUnique({
      where: { tokenHash },
      include: { role: true, org: true },
    });

    if (!invitation) {
      throw new NotFoundError('Invitation not found or invalid token');
    }

    // Check revoked
    if (invitation.revokedAt !== null) {
      throw new ConflictError('Invitation has been revoked');
    }

    // Check accepted (token single-use / reuse detection)
    if (invitation.acceptedAt !== null) {
      throw new ConflictError('Invitation has already been accepted');
    }

    // Check expiration
    if (invitation.expiresAt < new Date()) {
      throw new ConflictError('Invitation has expired');
    }

    // Check email match: authenticated user's email must match invite email
    if (userEmail.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new ForbiddenError('Invitation was issued for a different email address');
    }

    // Check if user is already a member
    const existingMembership = await prisma.membership.findUnique({
      where: {
        userId_orgId: {
          userId,
          orgId: invitation.orgId,
        },
      },
    });

    if (existingMembership && existingMembership.status === 'ACTIVE') {
      throw new ConflictError('User is already an active member of this organization');
    }

    // Accept invitation and create membership in a single transaction
    return await prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      const membership = await tx.membership.create({
        data: {
          userId,
          orgId: invitation.orgId,
          roleId: invitation.roleId,
          status: 'ACTIVE',
        },
      });

      await recordAudit(tx, {
        orgId: invitation.orgId,
        actorId: userId,
        action: 'invitation.accept',
        targetType: 'Invitation',
        targetId: invitation.id,
        metadata: {
          email: invitation.email,
          roleId: invitation.roleId,
        },
      });

      return {
        message: 'Invitation accepted successfully',
        membership: {
          id: membership.id,
          userId: membership.userId,
          orgId: membership.orgId,
          roleId: membership.roleId,
          status: membership.status,
          createdAt: membership.createdAt.toISOString(),
        },
      };
    });
  }
}

export const invitationsService = new InvitationsService();
