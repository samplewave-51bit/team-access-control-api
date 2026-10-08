import { prisma } from '../../lib/prisma';

export class PermissionsService {
  async listPermissions() {
    return prisma.permission.findMany({
      select: {
        key: true,
        description: true,
      },
      orderBy: { key: 'asc' },
    });
  }
}

export const permissionsService = new PermissionsService();
