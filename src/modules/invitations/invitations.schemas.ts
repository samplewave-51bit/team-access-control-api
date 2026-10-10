import { z } from 'zod';
import { errorResponseSchema, registry } from '../../docs/openapi';

export const orgInvitationParamsSchema = z
  .object({
    orgId: z
      .string()
      .uuid('Invalid organization ID')
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
  })
  .strict();

export const invitationIdParamsSchema = z
  .object({
    orgId: z
      .string()
      .uuid('Invalid organization ID')
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    id: z
      .string()
      .uuid('Invalid invitation ID')
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174001' }),
  })
  .strict();

export const createInvitationBodySchema = z
  .object({
    email: z
      .string()
      .email('Invalid email address')
      .transform((val) => val.toLowerCase().trim())
      .openapi({ example: 'colleague@example.com' }),
    roleId: z
      .string()
      .uuid('Invalid role ID')
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174002' }),
  })
  .strict();

export const listInvitationsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ example: 20 }),
    cursor: z
      .string()
      .uuid()
      .optional()
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174003' }),
    status: z.enum(['all', 'pending', 'accepted', 'revoked', 'expired']).default('all').optional(),
  })
  .strict();

export const acceptInvitationBodySchema = z
  .object({
    token: z.string().min(1, 'Token is required').openapi({ example: '4f2e9...' }),
  })
  .strict();

export const invitationItemSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  email: z.string().email(),
  roleId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  invitedById: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  inviteUrl: z.string().url().optional(),
  role: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      priority: z.number().int(),
      isSystem: z.boolean(),
    })
    .optional(),
  invitedBy: z
    .object({
      id: z.string().uuid(),
      email: z.string().email(),
      name: z.string(),
    })
    .optional(),
});

export const invitationResponseSchema = registry.register(
  'InvitationResponse',
  z.object({
    invitation: invitationItemSchema,
  }),
);

export const invitationsListResponseSchema = registry.register(
  'InvitationsListResponse',
  z.object({
    invitations: z.array(invitationItemSchema),
    pagination: z.object({
      nextCursor: z.string().uuid().nullable(),
      hasNextPage: z.boolean(),
    }),
  }),
);

export const acceptInvitationResponseSchema = registry.register(
  'AcceptInvitationResponse',
  z.object({
    message: z.string(),
    membership: z.object({
      id: z.string().uuid(),
      userId: z.string().uuid(),
      orgId: z.string().uuid(),
      roleId: z.string().uuid(),
      status: z.string(),
      createdAt: z.string().datetime(),
    }),
  }),
);

export const deleteInvitationResponseSchema = registry.register(
  'DeleteInvitationResponse',
  z.object({
    message: z.string(),
  }),
);

export const createInvitationSchema = {
  params: orgInvitationParamsSchema,
  body: createInvitationBodySchema,
};

export const listInvitationsSchema = {
  params: orgInvitationParamsSchema,
  query: listInvitationsQuerySchema,
};

export const deleteInvitationSchema = {
  params: invitationIdParamsSchema,
};

export const acceptInvitationSchema = {
  body: acceptInvitationBodySchema,
};

export type CreateInvitationInput = z.infer<typeof createInvitationBodySchema>;
export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationBodySchema>;

// OpenAPI route registrations
registry.registerPath({
  method: 'post',
  path: '/orgs/{orgId}/invitations',
  summary: 'Create organization invitation',
  description: 'Invites a user to the organization by email. Requires member:invite permission.',
  tags: ['Invitations'],
  security: [{ bearerAuth: [] }],
  request: {
    params: orgInvitationParamsSchema,
    body: {
      content: { 'application/json': { schema: createInvitationBodySchema } },
    },
  },
  responses: {
    201: {
      description: 'Invitation created successfully',
      content: { 'application/json': { schema: invitationResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'Forbidden - Cannot invite with equal or higher role priority',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Organization or role not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'Pending invitation or membership already exists for this email',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/orgs/{orgId}/invitations',
  summary: 'List organization invitations',
  description:
    'Lists invitations for an organization with pagination. Requires member:invite permission.',
  tags: ['Invitations'],
  security: [{ bearerAuth: [] }],
  request: {
    params: orgInvitationParamsSchema,
    query: listInvitationsQuerySchema,
  },
  responses: {
    200: {
      description: 'List of invitations',
      content: { 'application/json': { schema: invitationsListResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'Forbidden - Insufficient permissions',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Organization not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/orgs/{orgId}/invitations/{id}',
  summary: 'Revoke organization invitation',
  description: 'Revokes a pending invitation. Requires member:invite permission.',
  tags: ['Invitations'],
  security: [{ bearerAuth: [] }],
  request: {
    params: invitationIdParamsSchema,
  },
  responses: {
    200: {
      description: 'Invitation revoked successfully',
      content: { 'application/json': { schema: deleteInvitationResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'Forbidden - Cannot revoke invitation for role with equal/higher priority',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Invitation or organization not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'Invitation already accepted',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/invitations/accept',
  summary: 'Accept invitation',
  description:
    'Accepts an invitation using the one-time token. Authenticated user email must match invitation email.',
  tags: ['Invitations'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: acceptInvitationBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Invitation accepted successfully and membership created',
      content: { 'application/json': { schema: acceptInvitationResponseSchema } },
    },
    400: {
      description: 'Invalid token or token expired',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'Forbidden - Token email does not match authenticated user email',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Invitation not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'Invitation already accepted, revoked, expired, or user already a member',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
