import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

export interface AuditEvent {
  orgId?: string | null;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

export async function recordAudit(
  tx: Prisma.TransactionClient | PrismaClient = prisma,
  event: AuditEvent,
) {
  return await tx.auditLog.create({
    data: {
      orgId: event.orgId ?? null,
      actorId: event.actorId ?? null,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId ?? null,
      metadata: (event.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      ip: event.ip ?? null,
    },
  });
}
