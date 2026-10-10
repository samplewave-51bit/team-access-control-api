import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ListAuditLogsQuery } from './audit.schemas';

export class AuditService {
  async listAuditLogs(orgId: string, query: ListAuditLogsQuery) {
    const limit = query.limit || 20;
    const cursor = query.cursor;

    const where: Prisma.AuditLogWhereInput = {
      orgId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const logs = await prisma.auditLog.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        actor: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    const hasNextPage = logs.length > limit;
    const items = hasNextPage ? logs.slice(0, limit) : logs;
    const nextCursor = hasNextPage ? items[items.length - 1].id : null;

    return {
      auditLogs: items.map((log) => ({
        id: log.id,
        orgId: log.orgId,
        actorId: log.actorId,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        metadata: (log.metadata as Record<string, unknown>) ?? null,
        ip: log.ip,
        createdAt: log.createdAt.toISOString(),
        actor: log.actor,
      })),
      pagination: {
        nextCursor,
        hasNextPage,
      },
    };
  }
}

export const auditService = new AuditService();
