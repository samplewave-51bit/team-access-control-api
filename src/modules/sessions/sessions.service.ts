import { recordAudit } from '../../lib/audit';
import { ForbiddenError, NotFoundError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { revokeSessionId } from '../../lib/redis';
import { MembershipWithRoleAndPermissions } from '../../middleware/requirePermission';

export class SessionsService {
  /**
   * List active sessions for the authenticated user.
   */
  async listUserSessions(userId: string, currentSessionId?: string) {
    const sessions = await prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        userId: s.userId,
        familyId: s.familyId,
        isCurrent: s.id === currentSessionId,
        userAgent: s.userAgent,
        ip: s.ip,
        lastUsedAt: s.lastUsedAt ? s.lastUsedAt.toISOString() : null,
        expiresAt: s.expiresAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Revoke a single session belonging to the authenticated user.
   */
  async revokeUserSession(userId: string, sessionId: string) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    // Own sessions only - return 404 if session doesn't exist or belongs to another user
    if (!session || session.userId !== userId) {
      throw new NotFoundError('Session not found');
    }

    if (session.revokedAt === null) {
      await prisma.session.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      });

      await revokeSessionId(sessionId);

      await recordAudit(prisma, {
        orgId: null,
        actorId: userId,
        action: 'session.revoke_own',
        targetType: 'Session',
        targetId: sessionId,
        metadata: { familyId: session.familyId },
      });
    }

    return {
      message: 'Session revoked successfully',
    };
  }

  /**
   * Admin revoke of member sessions within an organization.
   * Requires session:revoke permission and hierarchy enforcement (§3 Rule 3).
   */
  async revokeMemberSessions(
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

    // §3 Rule 3: Hierarchy rule if acting on another user
    if (caller.userId !== targetUserId && targetMember.role.priority >= caller.role.priority) {
      throw new ForbiddenError('Cannot revoke sessions for a member with equal or higher priority');
    }

    return await prisma.$transaction(async (tx) => {
      const activeSessions = await tx.session.findMany({
        where: {
          userId: targetUserId,
          revokedAt: null,
        },
        select: { id: true },
      });

      await tx.session.updateMany({
        where: {
          userId: targetUserId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      for (const s of activeSessions) {
        await revokeSessionId(s.id);
      }

      await recordAudit(tx, {
        orgId,
        actorId: caller.userId,
        action: 'member.sessions_revoke',
        targetType: 'Membership',
        targetId: targetMember.id,
        metadata: {
          targetUserId,
          revokedCount: activeSessions.length,
          targetRolePriority: targetMember.role.priority,
        },
      });

      return {
        message: 'Member sessions revoked successfully',
        revokedCount: activeSessions.length,
      };
    });
  }
}

export const sessionsService = new SessionsService();
