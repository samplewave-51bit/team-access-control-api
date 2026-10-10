import { randomUUID } from 'crypto';
import { recordAudit } from '../../lib/audit';
import { ConflictError, UnauthorizedError } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/hashing';
import { prisma } from '../../lib/prisma';
import { revokeSessionId } from '../../lib/redis';
import { generateAccessToken, generateRefreshToken, hashToken } from '../../lib/tokens';
import { LoginInput, RegisterInput } from './auth.schemas';

export interface SessionMetadata {
  userAgent?: string;
  ip?: string;
}

export class AuthService {
  async register(input: RegisterInput) {
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existingUser) {
      throw new ConflictError('Email is already registered');
    }

    const passwordHash = await hashPassword(input.password);

    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    return user;
  }

  async login(input: LoginInput, meta: SessionMetadata) {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user) {
      await recordAudit(prisma, {
        orgId: null,
        actorId: null,
        action: 'auth.login_failure',
        targetType: 'User',
        targetId: null,
        metadata: { email: input.email, reason: 'user_not_found' },
        ip: meta.ip,
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    // Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await recordAudit(prisma, {
        orgId: null,
        actorId: user.id,
        action: 'auth.login_failure',
        targetType: 'User',
        targetId: user.id,
        metadata: { email: input.email, reason: 'account_locked' },
        ip: meta.ip,
      });
      throw new UnauthorizedError('Account is temporarily locked. Please try again later.');
    }

    const isPasswordValid = await verifyPassword(input.password, user.passwordHash);

    if (!isPasswordValid) {
      const failedCount = user.failedLoginCount + 1;
      const isLocked = failedCount >= 5;
      const lockedUntil = isLocked ? new Date(Date.now() + 15 * 60 * 1000) : null;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failedCount,
          lockedUntil,
        },
      });

      await recordAudit(prisma, {
        orgId: null,
        actorId: user.id,
        action: 'auth.login_failure',
        targetType: 'User',
        targetId: user.id,
        metadata: { email: input.email, reason: 'invalid_password' },
        ip: meta.ip,
      });

      throw new UnauthorizedError('Invalid email or password');
    }

    // Reset lockout counters on successful login
    if (user.failedLoginCount > 0 || user.lockedUntil !== null) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
    }

    // Generate tokens and create session
    const { token: rawRefreshToken, hash: refreshTokenHash } = generateRefreshToken();
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        familyId,
        refreshTokenHash,
        expiresAt,
        userAgent: meta.userAgent,
        ip: meta.ip,
        lastUsedAt: new Date(),
      },
    });

    const accessToken = generateAccessToken(user.id, session.id);

    await recordAudit(prisma, {
      orgId: null,
      actorId: user.id,
      action: 'auth.login_success',
      targetType: 'User',
      targetId: user.id,
      metadata: { email: user.email },
      ip: meta.ip,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  async refresh(rawRefreshToken: string, meta: SessionMetadata) {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      throw new UnauthorizedError('Refresh token required');
    }

    const tokenHash = hashToken(rawRefreshToken);

    const session = await prisma.session.findUnique({
      where: { refreshTokenHash: tokenHash },
    });

    if (!session) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Check if token was already revoked (Reuse Detection)
    if (session.revokedAt !== null) {
      // Grace window check per §11: rotated within last 10s and replacement session exists
      const gracePeriodMs = 10000;
      const rotatedRecently = Date.now() - session.revokedAt.getTime() < gracePeriodMs;

      if (rotatedRecently && session.replacedById) {
        throw new UnauthorizedError('Refresh token was already rotated');
      }

      // Reuse detected outside grace window: revoke ENTIRE family!
      const activeFamilySessions = await prisma.session.findMany({
        where: { familyId: session.familyId, revokedAt: null },
      });

      await prisma.session.updateMany({
        where: { familyId: session.familyId },
        data: { revokedAt: new Date() },
      });

      for (const s of activeFamilySessions) {
        await revokeSessionId(s.id);
      }

      throw new UnauthorizedError(
        'Refresh token reuse detected. All sessions in this family have been revoked.',
      );
    }

    // Check expiration
    if (session.expiresAt <= new Date()) {
      throw new UnauthorizedError('Refresh token has expired');
    }

    // Rotate: generate new token and replace session in same family
    const { token: newRawRefreshToken, hash: newHash } = generateRefreshToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [newSession] = await prisma.$transaction([
      prisma.session.create({
        data: {
          userId: session.userId,
          familyId: session.familyId,
          refreshTokenHash: newHash,
          expiresAt,
          userAgent: meta.userAgent,
          ip: meta.ip,
          lastUsedAt: new Date(),
        },
      }),
      prisma.session.update({
        where: { id: session.id },
        data: {
          revokedAt: new Date(),
        },
      }),
    ]);

    await prisma.session.update({
      where: { id: session.id },
      data: { replacedById: newSession.id },
    });

    const accessToken = generateAccessToken(session.userId, newSession.id);

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
    };
  }

  async logout(sessionId: string) {
    await prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await revokeSessionId(sessionId);
  }

  async logoutAll(userId: string) {
    const activeSessions = await prisma.session.findMany({
      where: { userId, revokedAt: null },
      select: { id: true },
    });

    await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    for (const session of activeSessions) {
      await revokeSessionId(session.id);
    }

    await recordAudit(prisma, {
      orgId: null,
      actorId: userId,
      action: 'auth.logout_all',
      targetType: 'User',
      targetId: userId,
      metadata: { revokedCount: activeSessions.length },
    });
  }
}

export const authService = new AuthService();
