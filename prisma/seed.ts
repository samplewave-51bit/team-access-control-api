import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const PERMISSION_CATALOG = [
  { key: 'org:update', description: 'Update organization details' },
  { key: 'member:read', description: 'List and view organization members' },
  { key: 'member:invite', description: 'Invite new members to the organization' },
  { key: 'member:remove', description: 'Remove members from the organization' },
  { key: 'member:role.update', description: "Update a member's role" },
  { key: 'role:read', description: 'List and view organization roles' },
  { key: 'role:manage', description: 'Create, update, and delete custom roles' },
  { key: 'session:revoke', description: 'Revoke active sessions of members' },
  { key: 'audit:read', description: 'View organization audit logs' },
  { key: 'file:upload', description: 'Upload files to the organization' },
  { key: 'file:read:own', description: 'View and download own files' },
  { key: 'file:read:any', description: 'View and download any organization file' },
  { key: 'file:delete:own', description: 'Delete own files' },
  { key: 'file:delete:any', description: 'Delete any organization file' },
];

export async function seedPermissions(): Promise<void> {
  for (const perm of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: { description: perm.description },
      create: {
        key: perm.key,
        description: perm.description,
      },
    });
  }
}

async function main(): Promise<void> {
  console.log('Seeding permission catalog...');
  await seedPermissions();
  console.log(`Seeded ${PERMISSION_CATALOG.length} permissions successfully.`);
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error('Error during seeding:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
