import { ForbiddenError, NotFoundError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { MembershipWithRoleAndPermissions } from '../../middleware/requirePermission';
import { ListMembersQuery, UpdateMemberRoleInput } from './members.schemas';

export class MembersService {
  async listMembers(orgId: string, query: ListMembersQuery) {
    const limit = query.limit || 20;
    const cursor = query.cursor;

    const members = await prisma.membership.findMany({
      where: { orgId },
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            createdAt: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
            priority: true,
            isSystem: true,
          },
        },
      },
    });

    const hasNextPage = members.length > limit;
    const items = hasNextPage ? members.slice(0, limit) : members;
    const nextCursor = hasNextPage ? items[items.length - 1].id : null;

    return {
      members: items,
      pagination: {
        nextCursor,
        hasNextPage,
      },
    };
  }

  async updateMemberRole(
    orgId: string,
    targetUserId: string,
    caller: MembershipWithRoleAndPermissions,
    input: UpdateMemberRoleInput,
  ) {
    const targetMember = await prisma.membership.findUnique({
      where: { userId_orgId: { userId: targetUserId, orgId } },
      include: { role: true, user: true },
    });

    if (!targetMember || targetMember.status !== 'ACTIVE') {
      throw new NotFoundError('Member not found');
    }

    const newRole = await prisma.role.findUnique({
      where: { id: input.roleId },
    });

    if (!newRole || newRole.orgId !== orgId) {
      throw new NotFoundError('Role not found');
    }

    // §3 Rule 3: Hierarchy rule - caller can only change a member whose priority is strictly lower
    if (targetMember.role.priority >= caller.role.priority) {
      throw new ForbiddenError('Cannot modify the role of a member with equal or higher priority');
    }

    // §3 Rule 3: Assigning owner is NOT allowed (no owner transfer in v1)
    if (newRole.name === 'owner' || newRole.priority >= 100) {
      throw new ForbiddenError('Cannot assign owner role; owner assignment is not permitted');
    }

    // §3 Rule 3: Can only assign roles with priority <= caller's own
    if (newRole.priority > caller.role.priority) {
      throw new ForbiddenError('Cannot assign a role with priority higher than your own');
    }

    // Transaction with row locking on Organization to prevent concurrent demotion race
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${orgId} FOR UPDATE`;

      // §3 Rule 4: Last-owner rule
      if (targetMember.role.name === 'owner') {
        const ownerCount = await tx.membership.count({
          where: {
            orgId,
            role: { name: 'owner' },
            status: 'ACTIVE',
          },
        });
        if (ownerCount <= 1) {
          throw new ForbiddenError('Cannot demote the last owner of the organization');
        }
      }

      const updated = await tx.membership.update({
        where: { id: targetMember.id },
        data: { roleId: newRole.id },
        include: {
          user: {
            select: { id: true, email: true, name: true, createdAt: true },
          },
          role: {
            select: { id: true, name: true, priority: true, isSystem: true },
          },
        },
      });

      return {
        member: {
          id: updated.id,
          userId: updated.userId,
          orgId: updated.orgId,
          status: updated.status,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
          user: {
            id: updated.user.id,
            email: updated.user.email,
            name: updated.user.name,
            createdAt: updated.user.createdAt.toISOString(),
          },
          role: updated.role,
        },
      };
    });
  }

  async removeMember(
    orgId: string,
    targetUserId: string,
    caller: MembershipWithRoleAndPermissions,
  ) {
    const targetMember = await prisma.membership.findUnique({
      where: { userId_orgId: { userId: targetUserId, orgId } },
      include: { role: true },
    });

    if (!targetMember || targetMember.status !== 'ACTIVE') {
      throw new NotFoundError('Member not found');
    }

    // §3 Rule 3: Hierarchy rule if removing another user
    if (caller.userId !== targetUserId && targetMember.role.priority >= caller.role.priority) {
      throw new ForbiddenError('Cannot remove a member with equal or higher priority');
    }

    // Transaction with row locking on Organization to protect last owner
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${orgId} FOR UPDATE`;

      // §3 Rule 4: Last-owner rule
      if (targetMember.role.name === 'owner') {
        const ownerCount = await tx.membership.count({
          where: {
            orgId,
            role: { name: 'owner' },
            status: 'ACTIVE',
          },
        });
        if (ownerCount <= 1) {
          throw new ForbiddenError('Cannot remove the last owner of the organization');
        }
      }

      await tx.membership.delete({
        where: { id: targetMember.id },
      });

      return {
        message: 'Member removed successfully',
      };
    });
  }
}

export const membersService = new MembersService();
