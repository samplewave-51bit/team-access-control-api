import { Membership, Permission, Role, RolePermission } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../lib/errors';
import { prisma } from '../lib/prisma';

export type MembershipWithRoleAndPermissions = Membership & {
  role: Role & {
    rolePermissions: Array<RolePermission & { permission: Permission }>;
  };
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      membership?: MembershipWithRoleAndPermissions;
      permissions?: Set<string>;
    }
  }
}

export function requirePermission(permission: string | string[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const orgId = Array.isArray(req.params.orgId)
        ? req.params.orgId[0]
        : req.params.orgId || req.body?.orgId || req.query?.orgId;

      if (!orgId || typeof orgId !== 'string') {
        throw new NotFoundError('Organization not found');
      }

      // Permissions are loaded from the database on every request per §3 rule 6
      const membership = await prisma.membership.findUnique({
        where: {
          userId_orgId: {
            userId: req.user.id,
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

      // §3 Rule 1: Non-members get 404 (not 403) so org existence isn't leaked
      if (!membership || membership.status !== 'ACTIVE') {
        throw new NotFoundError('Organization not found');
      }

      const grantedKeys = new Set(membership.role.rolePermissions.map((rp) => rp.permission.key));
      const requiredKeys = Array.isArray(permission) ? permission : [permission];

      const hasAll = requiredKeys.every((key) => grantedKeys.has(key));
      if (!hasAll) {
        throw new ForbiddenError('Insufficient permissions');
      }

      req.membership = membership;
      req.permissions = grantedKeys;
      next();
    } catch (error) {
      next(error);
    }
  };
}
