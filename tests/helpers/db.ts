import { PrismaClient } from '@prisma/client';
import { seedPermissions } from '../../prisma/seed';

export const testPrisma = new PrismaClient();

export async function resetDatabase(): Promise<void> {
  // Truncate tables in reverse dependency order or with CASCADE
  await testPrisma.$executeRawUnsafe(`
    TRUNCATE TABLE 
      "File",
      "AuditLog",
      "Session",
      "Invitation",
      "RolePermission",
      "Membership",
      "Role",
      "Organization",
      "User"
    RESTART IDENTITY CASCADE;
  `);

  // Ensure permission catalog exists
  await seedPermissions();
}

export async function disconnectDatabase(): Promise<void> {
  await testPrisma.$disconnect();
}
