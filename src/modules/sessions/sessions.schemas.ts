import { z } from 'zod';
import { errorResponseSchema, registry } from '../../docs/openapi';

export const sessionIdParamsSchema = z
  .object({
    id: z
      .string()
      .uuid('Invalid session ID')
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
  })
  .strict();

export const sessionItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  familyId: z.string().uuid(),
  isCurrent: z.boolean(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export const sessionsListResponseSchema = registry.register(
  'SessionsListResponse',
  z.object({
    sessions: z.array(sessionItemSchema),
  }),
);

export const sessionActionResponseSchema = registry.register(
  'SessionActionResponse',
  z.object({
    message: z.string(),
  }),
);

export const revokeMemberSessionsResponseSchema = registry.register(
  'RevokeMemberSessionsResponse',
  z.object({
    message: z.string(),
    revokedCount: z.number(),
  }),
);

export const getSessionsSchema = {};

export const deleteSessionSchema = {
  params: sessionIdParamsSchema,
};

// OpenAPI Route Registrations
registry.registerPath({
  method: 'get',
  path: '/sessions',
  summary: 'List own active sessions',
  description:
    'Returns all active (non-revoked and non-expired) sessions belonging to the authenticated user.',
  tags: ['Sessions'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Active sessions for the authenticated user',
      content: {
        'application/json': {
          schema: sessionsListResponseSchema,
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
  method: 'delete',
  path: '/sessions/{id}',
  summary: 'Revoke own session',
  description:
    'Revokes a specific session belonging to the authenticated user, invalidating its access and refresh tokens.',
  tags: ['Sessions'],
  security: [{ bearerAuth: [] }],
  request: {
    params: sessionIdParamsSchema,
  },
  responses: {
    200: {
      description: 'Session revoked successfully',
      content: {
        'application/json': {
          schema: sessionActionResponseSchema,
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
    404: {
      description: 'Session not found or belongs to another user',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

export const revokeMemberSessionsParamsSchema = z
  .object({
    orgId: z
      .string()
      .uuid('Invalid organization ID')
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    userId: z
      .string()
      .uuid('Invalid user ID')
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174001' }),
  })
  .strict();

export const revokeMemberSessionsSchema = {
  params: revokeMemberSessionsParamsSchema,
};

registry.registerPath({
  method: 'post',
  path: '/orgs/{orgId}/members/{userId}/revoke-sessions',
  summary: 'Admin revoke member sessions',
  description:
    'Revokes all active sessions for a target member within the organization. Requires session:revoke permission and caller hierarchy strictly higher than target.',
  tags: ['Members', 'Sessions'],
  security: [{ bearerAuth: [] }],
  request: {
    params: revokeMemberSessionsParamsSchema,
  },
  responses: {
    200: {
      description: 'Member sessions revoked successfully',
      content: {
        'application/json': {
          schema: revokeMemberSessionsResponseSchema,
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
    403: {
      description: 'Forbidden - Insufficient permission or hierarchy rule violation',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: 'Organization or target member not found',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});
