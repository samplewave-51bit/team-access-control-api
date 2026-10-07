import { ConflictError } from '../../lib/errors';
import { hashPassword } from '../../lib/hashing';
import { prisma } from '../../lib/prisma';
import { RegisterInput } from './auth.schemas';

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
}

export const authService = new AuthService();
