import { Prisma } from '@prisma/client';
import { ForbiddenError, NotFoundError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { CreateOrgInput, UpdateOrgInput } from './orgs.schemas';

export const SYSTEM_ROLES_CONFIG = [
  {
    name: 'owner',
    priority: 100,
    isSystem: true,
    permissions: [
      'org:update',
      'member:read',
      'member:invite',
      'member:remove',
      'member:role.update',
      'role:read',
      'role:manage',
      'session:revoke',
      'audit:read',
      'file:upload',
      'file:read:own',
      'file:read:any',
      'file:delete:own',
      'file:delete:any',
    ],
  },
  {
    name: 'admin',
    priority: 80,
    isSystem: true,
    permissions: [
      'member:read',
      'member:invite',
      'member:remove',
      'member:role.update',
      'role:read',
      'session:revoke',
      'audit:read',
      'file:upload',
      'file:read:own',
      'file:read:any',
      'file:delete:own',
      'file:delete:any',
    ],
  },
  {
    name: 'member',
    priority: 50,
    isSystem: true,
    permissions: ['member:read', 'role:read', 'file:upload', 'file:read:own', 'file:delete:own'],
  },
  {
    name: 'viewer',
    priority: 10,
    isSystem: true,
    permissions: ['member:read', 'role:read', 'file:read:own'],
  },
];

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export async function generateUniqueSlug(
  tx: Prisma.TransactionClient,
  baseName: string,
): Promise<string> {
  const baseSlug = slugify(baseName) || 'org';
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await tx.organization.findUnique({ where: { slug } });
    if (!existing) {
      return slug;
    }
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

export class OrgsService {
  async createOrg(
    userId: string,
    input: CreateOrgInput,
    transactionHook?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    return prisma.$transaction(async (tx) => {
      // 1. Fetch all permissions to map keys to IDs
      const permissions = await tx.permission.findMany();
      const permMap = new Map(permissions.map((p) => [p.key, p.id]));

      // 2. Generate unique slug with collision resolution
      const slug = await generateUniqueSlug(tx, input.name);

      // 3. Create organization
      const org = await tx.organization.create({
        data: {
          name: input.name,
          slug,
          createdById: userId,
        },
      });

      // 4. Create system roles & role permissions
      let ownerRoleId = '';
      for (const roleDef of SYSTEM_ROLES_CONFIG) {
        const role = await tx.role.create({
          data: {
            orgId: org.id,
            name: roleDef.name,
            priority: roleDef.priority,
            isSystem: roleDef.isSystem,
          },
        });

        if (roleDef.name === 'owner') {
          ownerRoleId = role.id;
        }

        const rolePermData = roleDef.permissions
          .map((permKey) => {
            const permId = permMap.get(permKey);
            return permId ? { roleId: role.id, permissionId: permId } : null;
          })
          .filter((item): item is { roleId: string; permissionId: string } => item !== null);

        if (rolePermData.length > 0) {
          await tx.rolePermission.createMany({
            data: rolePermData,
          });
        }
      }

      // 5. Create owner membership for creator
      await tx.membership.create({
        data: {
          userId,
          orgId: org.id,
          roleId: ownerRoleId,
          status: 'ACTIVE',
        },
      });

      // Optional test hook to simulate failure and test rollback
      if (transactionHook) {
        await transactionHook(tx);
      }

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        createdById: org.createdById,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt,
      };
    });
  }

  async listUserOrgs(userId: string) {
    const memberships = await prisma.membership.findMany({
      where: { userId },
      include: {
        org: true,
        role: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return memberships.map((m) => ({
      id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      createdById: m.org.createdById,
      createdAt: m.org.createdAt,
      updatedAt: m.org.updatedAt,
      role: m.role.name,
    }));
  }

  async getOrgById(userId: string, orgId: string) {
    const membership = await prisma.membership.findUnique({
      where: {
        userId_orgId: {
          userId,
          orgId,
        },
      },
      include: {
        org: true,
        role: true,
      },
    });

    if (!membership) {
      throw new NotFoundError('Organization not found');
    }

    return {
      id: membership.org.id,
      name: membership.org.name,
      slug: membership.org.slug,
      createdById: membership.org.createdById,
      createdAt: membership.org.createdAt,
      updatedAt: membership.org.updatedAt,
      role: membership.role.name,
    };
  }

  async updateOrg(userId: string, orgId: string, input: UpdateOrgInput) {
    const membership = await prisma.membership.findUnique({
      where: {
        userId_orgId: {
          userId,
          orgId,
        },
      },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundError('Organization not found');
    }

    const hasOrgUpdate = membership.role.rolePermissions.some(
      (rp) => rp.permission.key === 'org:update',
    );

    if (!hasOrgUpdate) {
      throw new ForbiddenError('Insufficient permissions to update organization');
    }

    const updatedOrg = await prisma.organization.update({
      where: { id: orgId },
      data: { name: input.name },
    });

    return {
      id: updatedOrg.id,
      name: updatedOrg.name,
      slug: updatedOrg.slug,
      createdById: updatedOrg.createdById,
      createdAt: updatedOrg.createdAt,
      updatedAt: updatedOrg.updatedAt,
    };
  }
}

export const orgsService = new OrgsService();
