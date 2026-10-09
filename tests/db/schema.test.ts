import { PERMISSION_CATALOG } from '../../prisma/seed';
import { disconnectDatabase, resetDatabase, testPrisma } from '../helpers/db';

describe('Database Schema & Seed', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('should seed all 14 permissions into the database', async () => {
    const permissions = await testPrisma.permission.findMany({
      orderBy: { key: 'asc' },
    });

    expect(permissions).toHaveLength(PERMISSION_CATALOG.length);
    const keys = permissions.map((p) => p.key);
    expect(keys).toContain('org:update');
    expect(keys).toContain('member:invite');
    expect(keys).toContain('file:upload');
    expect(keys).toContain('audit:read');
  });

  it('should create and retrieve a user with required fields', async () => {
    const user = await testPrisma.user.create({
      data: {
        email: 'test@example.com',
        passwordHash: 'hashed_pw',
        name: 'Test User',
      },
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe('test@example.com');
    expect(user.isActive).toBe(true);
    expect(user.failedLoginCount).toBe(0);
  });

  it('should enforce unique email constraint on User', async () => {
    await testPrisma.user.create({
      data: {
        email: 'duplicate@example.com',
        passwordHash: 'hashed_pw',
        name: 'First User',
      },
    });

    await expect(
      testPrisma.user.create({
        data: {
          email: 'duplicate@example.com',
          passwordHash: 'another_hashed_pw',
          name: 'Second User',
        },
      }),
    ).rejects.toThrow();
  });
});
