import { NextFunction, Request, Response } from 'express';
import { RateLimiterRes } from 'rate-limiter-flexible';
import { getRateLimiter, RateLimiterConfig } from '../config/rateLimits';
import { RateLimitError } from '../lib/errors';
import { logger } from '../lib/logger';

export function createRateLimiterMiddleware(config: RateLimiterConfig) {
  const limiter = getRateLimiter({
    keyPrefix: config.keyPrefix,
    points: config.points,
    duration: config.duration,
  });

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = config.keyGenerator(req);

    try {
      const rateLimiterRes: RateLimiterRes = await limiter.consume(key);

      // Set standard RateLimit headers
      res.setHeader('RateLimit-Limit', config.points);
      res.setHeader('RateLimit-Remaining', rateLimiterRes.remainingPoints);
      res.setHeader(
        'RateLimit-Reset',
        Math.ceil(Date.now() / 1000) + Math.ceil(rateLimiterRes.msBeforeNext / 1000),
      );

      next();
    } catch (err: unknown) {
      if (err instanceof RateLimiterRes) {
        const retryAfterSeconds = Math.ceil(err.msBeforeNext / 1000) || 1;

        res.setHeader('Retry-After', retryAfterSeconds);
        res.setHeader('RateLimit-Limit', config.points);
        res.setHeader('RateLimit-Remaining', 0);
        res.setHeader('RateLimit-Reset', Math.ceil(Date.now() / 1000) + retryAfterSeconds);

        return next(
          new RateLimitError(
            `Too many requests. Please try again after ${retryAfterSeconds} seconds.`,
          ),
        );
      }

      // If Redis has an error or is unreachable, log warning and fail open for rate limiting
      logger.warn({ err, keyPrefix: config.keyPrefix }, 'Rate limiter storage error, bypassing');
      next();
    }
  };
}
