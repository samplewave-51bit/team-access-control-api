import { randomUUID } from 'crypto';
import { ConflictError, UnauthorizedError } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/hashing';
import { prisma } from '../../lib/prisma';
import { generateAccessToken, generateRefreshToken } from '../../lib/tokens';
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
      throw new UnauthorizedError('Invalid email or password');
    }

    // Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
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
}

export const authService = new AuthService();
