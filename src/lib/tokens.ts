import { createHash, randomBytes, randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UnauthorizedError } from './errors';

export interface AccessTokenPayload {
  sub: string; // userId
  sid: string; // sessionId
  jti: string; // token identifier
}

export function generateAccessToken(userId: string, sessionId: string): string {
  const payload: AccessTokenPayload = {
    sub: userId,
    sid: sessionId,
    jti: randomUUID(),
  };

  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as AccessTokenPayload;

    if (!decoded.sub || !decoded.sid) {
      throw new UnauthorizedError('Invalid token payload');
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Authentication token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new UnauthorizedError('Invalid authentication token');
    }
    throw error;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  const hash = hashToken(token);
  return { token, hash };
}
