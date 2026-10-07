import { z } from 'zod';
import { errorResponseSchema, registry } from '../../docs/openapi';

export const registerBodySchema = z
  .object({
    email: z
      .string()
      .email('Invalid email address')
      .transform((val) => val.trim().toLowerCase())
      .openapi({ example: 'user@example.com' }),
    name: z
      .string()
      .min(1, 'Name is required')
      .max(100, 'Name must not exceed 100 characters')
      .transform((val) => val.trim())
      .openapi({ example: 'John Doe' }),
    password: z
      .string()
      .min(10, 'Password must be at least 10 characters long')
      .openapi({ example: 'P@ssword1234!' }),
  })
  .strict()
  .refine(
    (data) => {
      return data.password.toLowerCase() !== data.email.toLowerCase();
    },
    {
      message: 'Password must not be equal to email',
      path: ['password'],
    },
  );

export const userResponseSchema = registry.register(
  'UserResponse',
  z.object({
    user: z.object({
      id: z.string().uuid().openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
      email: z.string().email().openapi({ example: 'user@example.com' }),
      name: z.string().openapi({ example: 'John Doe' }),
      createdAt: z.string().datetime().openapi({ example: '2026-10-07T12:00:00.000Z' }),
    }),
  }),
);

export const registerSchema = {
  body: registerBodySchema,
};

export type RegisterInput = z.infer<typeof registerBodySchema>;

// Register endpoint with OpenAPI
registry.registerPath({
  method: 'post',
  path: '/auth/register',
  summary: 'Register a new user',
  description: 'Creates a new user account with argon2id hashed password.',
  tags: ['Auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: registerBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'User registered successfully',
      content: {
        'application/json': {
          schema: userResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error (e.g., password too short or equals email)',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
    409: {
      description: 'Conflict - Email is already registered',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});
