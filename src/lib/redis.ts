import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

const redisUrl = new URL(env.REDIS_URL);
if (env.NODE_ENV === 'test') {
  // Use Redis database 1 for tests per §11 Known Pitfalls
  redisUrl.pathname = '/1';
}

export const redis = new Redis(redisUrl.toString(), {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

export async function getRedisClient(): Promise<Redis> {
  if (redis.status === 'wait' || redis.status === 'close') {
    await redis.connect();
  }
  return redis;
}

export async function revokeSessionId(sid: string, ttlSeconds = 900): Promise<void> {
  try {
    const client = await getRedisClient();
    await client.set(`revoked:sid:${sid}`, '1', 'EX', ttlSeconds);
  } catch (err) {
    logger.error({ err, sid }, 'Failed to set session revocation in Redis');
    if (env.NODE_ENV === 'production') {
      throw err; // Fail closed in production per §5
    }
  }
}

export async function isSessionIdRevoked(sid: string): Promise<boolean> {
  try {
    const client = await getRedisClient();
    const result = await client.get(`revoked:sid:${sid}`);
    return result !== null;
  } catch (err) {
    logger.error({ err, sid }, 'Failed to check session revocation in Redis');
    if (env.NODE_ENV === 'production') {
      throw err; // Fail closed in production per §5
    }
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis.status !== 'close' && redis.status !== 'end') {
    await redis.quit();
  }
}
