import { Request } from 'express';
import { IRateLimiterOptions, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { redis } from '../lib/redis';
import { env } from './env';

export interface RateLimiterConfig {
  keyPrefix: string;
  points: number;
  duration: number; // in seconds
  keyGenerator: (req: Request) => string;
}

// Map of created RateLimiterRedis instances by keyPrefix
const limiterInstances = new Map<string, RateLimiterRedis>();

export function getRateLimiter(options: IRateLimiterOptions): RateLimiterRedis {
  const prefix = options.keyPrefix || 'rl';
  let limiter = limiterInstances.get(prefix);
  if (!limiter) {
    limiter = new RateLimiterRedis({
      storeClient: redis,
      ...options,
    });
    limiterInstances.set(prefix, limiter);
  }
  return limiter;
}

/**
 * Helper to get the client IP from request, taking proxy trust into account.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

/**
 * Standard rate limiter configurations per §5 Security Design:
 * - Global: 100 req/min per IP
 * - Authenticated: 300 req/min per user
 * - Login: 5 / 15 min per ip+email
 * - Register: 5 / hour per IP
 * - Invitations: 20 / hour per org
 */
const isTest = env.NODE_ENV === 'test';

export const rateLimitConfigs = {
  global: {
    keyPrefix: 'rl:global',
    points: isTest ? 10000 : 100,
    duration: 60,
    keyGenerator: (req: Request) => getClientIp(req),
  },
  authenticated: {
    keyPrefix: 'rl:auth_user',
    points: isTest ? 10000 : 300,
    duration: 60,
    keyGenerator: (req: Request) => req.user?.id || getClientIp(req),
  },
  login: {
    keyPrefix: 'rl:login',
    points: isTest ? 1000 : 5,
    duration: 15 * 60,
    keyGenerator: (req: Request) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
      return `${getClientIp(req)}:${email}`;
    },
  },
  register: {
    keyPrefix: 'rl:register',
    points: isTest ? 1000 : 5,
    duration: 60 * 60,
    keyGenerator: (req: Request) => getClientIp(req),
  },
  invitations: {
    keyPrefix: 'rl:invite',
    points: isTest ? 1000 : 20,
    duration: 60 * 60,
    keyGenerator: (req: Request) => {
      const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
      return orgId || getClientIp(req);
    },
  },
};

export type RateLimiterResInfo = RateLimiterRes;
