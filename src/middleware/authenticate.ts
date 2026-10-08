import { Session, User } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { isSessionIdRevoked } from '../lib/redis';
import { verifyAccessToken } from '../lib/tokens';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      session?: Session;
    }
  }
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authentication token required');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthorizedError('Authentication token required');
    }

    const payload = verifyAccessToken(token);

    // 1. Instant revocation check via Redis
    const isRevoked = await isSessionIdRevoked(payload.sid);
    if (isRevoked) {
      throw new UnauthorizedError('Session has expired or been revoked');
    }

    // 2. Verify session existence and validity in database
    const session = await prisma.session.findUnique({
      where: { id: payload.sid },
    });

    if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) {
      throw new UnauthorizedError('Session has expired or been revoked');
    }

    // 3. Verify user status
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedError('User account is inactive or not found');
    }

    req.user = user;
    req.session = session;
    next();
  } catch (error) {
    next(error);
  }
}
