import { z } from 'zod';
import { errorResponseSchema, registry } from '../../docs/openapi';

export const listMembersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ example: 20 }),
    cursor: z
      .string()
      .uuid()
      .optional()
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
  })
  .strict();

export const memberOrgParamsSchema = z
  .object({
    orgId: z.string().uuid().openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
  })
  .strict();

export const memberItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  status: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    createdAt: z.string().datetime(),
  }),
  role: z.object({
    id: z.string().uuid(),
    name: z.string(),
    priority: z.number(),
    isSystem: z.boolean(),
  }),
});

export const membersListResponseSchema = registry.register(
  'MembersListResponse',
  z.object({
    members: z.array(memberItemSchema),
    pagination: z.object({
      nextCursor: z.string().uuid().nullable(),
      hasNextPage: z.boolean(),
    }),
  }),
);

export const listMembersSchema = {
  params: memberOrgParamsSchema,
  query: listMembersQuerySchema,
};

export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;

// OpenAPI registration
registry.registerPath({
  method: 'get',
  path: '/orgs/{orgId}/members',
  summary: 'List organization members',
  description: 'Returns a paginated list of organization members. Requires member:read permission.',
  tags: ['Members'],
  security: [{ bearerAuth: [] }],
  request: {
    params: memberOrgParamsSchema,
    query: listMembersQuerySchema,
  },
  responses: {
    200: {
      description: 'List of members with pagination',
      content: {
        'application/json': {
          schema: membersListResponseSchema,
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
      description: 'Forbidden - Insufficient permissions',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: 'Organization not found (or caller not a member)',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});
