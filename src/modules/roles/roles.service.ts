import { recordAudit } from '../../lib/audit';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { MembershipWithRoleAndPermissions } from '../../middleware/requirePermission';
import { CreateRoleInput, UpdateRoleInput } from './roles.schemas';

export class RolesService {
  async listRoles(orgId: string) {
    const roles = await prisma.role.findMany({
      where: { orgId },
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    return {
      roles: roles.map((role) => ({
        id: role.id,
        orgId: role.orgId,
        name: role.name,
        priority: role.priority,
        isSystem: role.isSystem,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
        permissions: role.rolePermissions.map((rp) => rp.permission.key),
      })),
    };
  }

  async createRole(
    orgId: string,
    caller: MembershipWithRoleAndPermissions,
    callerPermissions: Set<string>,
    input: CreateRoleInput,
  ) {
    // §3 Rule 3 & 5: Custom roles cannot get priority >= creator's own
    if (input.priority >= caller.role.priority) {
      throw new ForbiddenError(
        'Cannot create a role with priority equal to or higher than your own',
      );
    }

    // Privilege escalation check: cannot assign permissions creator does not have
    for (const perm of input.permissions) {
      if (!callerPermissions.has(perm)) {
        throw new ForbiddenError(`Cannot assign permission '${perm}' which you do not possess`);
      }
    }

    // Validate that all permissions exist in the catalog
    let foundPerms: Array<{ id: string; key: string }> = [];
    if (input.permissions.length > 0) {
      foundPerms = await prisma.permission.findMany({
        where: { key: { in: input.permissions } },
        select: { id: true, key: true },
      });
      const uniqueInput = new Set(input.permissions);
      if (foundPerms.length !== uniqueInput.size) {
        throw new ValidationError('Invalid permission keys provided');
      }
    }

    // Check unique role name in organization
    const existing = await prisma.role.findUnique({
      where: {
        orgId_name: {
          orgId,
          name: input.name,
        },
      },
    });
    if (existing) {
      throw new ConflictError('Role with this name already exists in this organization');
    }

    // Create role and assign permissions in a transaction
    const createdRole = await prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          orgId,
          name: input.name,
          priority: input.priority,
          isSystem: false,
        },
      });

      if (foundPerms.length > 0) {
        await tx.rolePermission.createMany({
          data: foundPerms.map((perm) => ({
            roleId: role.id,
            permissionId: perm.id,
          })),
        });
      }

      await recordAudit(tx, {
        orgId,
        actorId: caller.userId,
        action: 'role.create',
        targetType: 'Role',
        targetId: role.id,
        metadata: {
          name: role.name,
          priority: role.priority,
          permissions: input.permissions,
        },
      });

      return role;
    });

    return {
      role: {
        id: createdRole.id,
        orgId: createdRole.orgId,
        name: createdRole.name,
        priority: createdRole.priority,
        isSystem: createdRole.isSystem,
        createdAt: createdRole.createdAt.toISOString(),
        updatedAt: createdRole.updatedAt.toISOString(),
        permissions: input.permissions,
      },
    };
  }

  async updateRole(
    orgId: string,
    roleId: string,
    caller: MembershipWithRoleAndPermissions,
    callerPermissions: Set<string>,
    input: UpdateRoleInput,
  ) {
    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!role || role.orgId !== orgId) {
      throw new NotFoundError('Role not found');
    }

    // §3 Rule 5: System roles cannot be edited or deleted
    if (role.isSystem) {
      throw new ForbiddenError('System roles cannot be modified');
    }

    // §3 Rule 3: Hierarchy rule: caller must strictly outrank target role
    if (role.priority >= caller.role.priority) {
      throw new ForbiddenError(
        'Cannot modify a role with priority equal to or higher than your own',
      );
    }

    // Cannot set priority >= caller priority
    if (input.priority !== undefined && input.priority >= caller.role.priority) {
      throw new ForbiddenError('Cannot set role priority equal to or higher than your own');
    }

    // Check unique name if updated
    if (input.name !== undefined && input.name !== role.name) {
      const existing = await prisma.role.findUnique({
        where: {
          orgId_name: {
            orgId,
            name: input.name,
          },
        },
      });
      if (existing) {
        throw new ConflictError('Role with this name already exists in this organization');
      }
    }

    // Validate permissions and check privilege escalation
    let foundPerms: Array<{ id: string; key: string }> = [];
    if (input.permissions !== undefined) {
      for (const perm of input.permissions) {
        if (!callerPermissions.has(perm)) {
          throw new ForbiddenError(`Cannot assign permission '${perm}' which you do not possess`);
        }
      }

      if (input.permissions.length > 0) {
        foundPerms = await prisma.permission.findMany({
          where: { key: { in: input.permissions } },
          select: { id: true, key: true },
        });
        const uniqueInput = new Set(input.permissions);
        if (foundPerms.length !== uniqueInput.size) {
          throw new ValidationError('Invalid permission keys provided');
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id: roleId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
        },
      });

      if (input.permissions !== undefined) {
        await tx.rolePermission.deleteMany({
          where: { roleId },
        });

        if (foundPerms.length > 0) {
          await tx.rolePermission.createMany({
            data: foundPerms.map((perm) => ({
              roleId,
              permissionId: perm.id,
            })),
          });
        }
      }

      await recordAudit(tx, {
        orgId,
        actorId: caller.userId,
        action: 'role.update',
        targetType: 'Role',
        targetId: roleId,
        metadata: {
          name: input.name,
          priority: input.priority,
          permissions: input.permissions,
        },
      });
    });

    const updated = await prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    return {
      role: {
        id: updated.id,
        orgId: updated.orgId,
        name: updated.name,
        priority: updated.priority,
        isSystem: updated.isSystem,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        permissions: updated.rolePermissions.map((rp) => rp.permission.key),
      },
    };
  }

  async deleteRole(orgId: string, roleId: string, caller: MembershipWithRoleAndPermissions) {
    const role = await prisma.role.findUnique({
      where: { id: roleId },
    });

    if (!role || role.orgId !== orgId) {
      throw new NotFoundError('Role not found');
    }

    // §3 Rule 5: System roles cannot be deleted
    if (role.isSystem) {
      throw new ForbiddenError('System roles cannot be deleted');
    }

    // Hierarchy rule: caller must strictly outrank target role
    if (role.priority >= caller.role.priority) {
      throw new ForbiddenError(
        'Cannot delete a role with priority equal to or higher than your own',
      );
    }

    // Cannot delete a role that has active members -> 409 Conflict
    const memberCount = await prisma.membership.count({
      where: { roleId },
    });

    if (memberCount > 0) {
      throw new ConflictError('Cannot delete a role that currently has members');
    }

    await prisma.$transaction(async (tx) => {
      await tx.role.delete({
        where: { id: roleId },
      });

      await recordAudit(tx, {
        orgId,
        actorId: caller.userId,
        action: 'role.delete',
        targetType: 'Role',
        targetId: roleId,
        metadata: {
          name: role.name,
        },
      });
    });

    return {
      message: 'Role deleted successfully',
    };
  }
}

export const rolesService = new RolesService();
