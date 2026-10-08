import { prisma } from '../../lib/prisma';
import { ListMembersQuery } from './members.schemas';

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
}

export const membersService = new MembersService();
