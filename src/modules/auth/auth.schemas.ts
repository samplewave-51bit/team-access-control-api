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

export const loginBodySchema = z
  .object({
    email: z
      .string()
      .email('Invalid email address')
      .transform((val) => val.trim().toLowerCase())
      .openapi({ example: 'user@example.com' }),
    password: z.string().min(1, 'Password is required').openapi({ example: 'P@ssword1234!' }),
  })
  .strict();

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

export const loginResponseSchema = registry.register(
  'LoginResponse',
  z.object({
    accessToken: z.string().openapi({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }),
    user: z.object({
      id: z.string().uuid().openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
      email: z.string().email().openapi({ example: 'user@example.com' }),
      name: z.string().openapi({ example: 'John Doe' }),
      createdAt: z.string().datetime().openapi({ example: '2026-10-07T12:00:00.000Z' }),
    }),
  }),
);

export const refreshResponseSchema = registry.register(
  'RefreshResponse',
  z.object({
    accessToken: z.string().openapi({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }),
  }),
);

export const messageResponseSchema = registry.register(
  'MessageResponse',
  z.object({
    message: z.string().openapi({ example: 'Operation completed successfully' }),
  }),
);

export const registerSchema = {
  body: registerBodySchema,
};

export const loginSchema = {
  body: loginBodySchema,
};

export type RegisterInput = z.infer<typeof registerBodySchema>;
export type LoginInput = z.infer<typeof loginBodySchema>;

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
      description: 'Validation error',
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

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  summary: 'Log in to an existing account',
  description: 'Authenticates user credentials, creates a session, and issues tokens.',
  tags: ['Auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: loginBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'User authenticated successfully',
      headers: {
        'Set-Cookie': {
          description: 'httpOnly refresh token cookie',
          schema: { type: 'string' },
        },
      },
      content: {
        'application/json': {
          schema: loginResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized - Invalid credentials or account locked',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/refresh',
  summary: 'Rotate refresh token and get a new access token',
  description:
    'Consumes the current refresh token cookie and issues a new access token and rotated refresh cookie.',
  tags: ['Auth'],
  responses: {
    200: {
      description: 'Token refreshed successfully',
      content: {
        'application/json': {
          schema: refreshResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized - Invalid, expired or reused refresh token',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  summary: 'Log out current session',
  description: 'Revokes the current session and invalidates its access token.',
  tags: ['Auth'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Logged out successfully',
      content: {
        'application/json': {
          schema: messageResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout-all',
  summary: 'Log out all sessions',
  description: 'Revokes all active sessions for the user across all devices.',
  tags: ['Auth'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Logged out from all devices successfully',
      content: {
        'application/json': {
          schema: messageResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/auth/me',
  summary: 'Get current authenticated user',
  description: 'Returns profile details for the authenticated user.',
  tags: ['Auth'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Current user profile',
      content: {
        'application/json': {
          schema: userResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized - Missing, invalid or expired token',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});
