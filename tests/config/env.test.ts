import { parseEnv } from '../../src/config/env';

describe('Environment Configuration', () => {
  const validEnv = {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgresql://tac:tac@localhost:5432/tac',
    TEST_DATABASE_URL: 'postgresql://tac:tac@localhost:5432/tac_test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a-very-long-secret-key-that-is-at-least-32-chars-long',
    ACCESS_TOKEN_TTL: '15m',
    REFRESH_TOKEN_TTL_DAYS: '7',
    COOKIE_SECURE: 'false',
    CORS_ORIGINS: 'http://localhost:3000',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'auto',
    S3_BUCKET: 'tac-files',
    S3_ACCESS_KEY: 'minioadmin',
    S3_SECRET_KEY: 'minioadmin',
    S3_FORCE_PATH_STYLE: 'true',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    SMTP_USER: '',
    SMTP_PASS: '',
    MAIL_FROM: 'no-reply@tac.local',
    APP_URL: 'http://localhost:3000',
  };

  it('should parse valid environment variables successfully', () => {
    const parsed = parseEnv(validEnv);
    expect(parsed.PORT).toBe(3000);
    expect(parsed.COOKIE_SECURE).toBe(false);
    expect(parsed.S3_FORCE_PATH_STYLE).toBe(true);
    expect(parsed.REFRESH_TOKEN_TTL_DAYS).toBe(7);
    expect(parsed.NODE_ENV).toBe('test');
  });

  it('should throw an error if a required field is missing', () => {
    const invalidEnv = { ...validEnv, DATABASE_URL: '' };
    expect(() => parseEnv(invalidEnv)).toThrow('Environment validation failed');
  });

  it('should throw an error if JWT_ACCESS_SECRET is shorter than 32 characters', () => {
    const invalidEnv = { ...validEnv, JWT_ACCESS_SECRET: 'short-secret' };
    expect(() => parseEnv(invalidEnv)).toThrow(/JWT_ACCESS_SECRET must be at least 32 characters/);
  });
});
