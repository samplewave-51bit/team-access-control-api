import { z } from 'zod';
import { errorResponseSchema, registry } from '../../docs/openapi';

export const createOrgBodySchema = z
  .object({
    name: z
      .string()
      .min(1, 'Organization name is required')
      .max(100, 'Organization name must not exceed 100 characters')
      .transform((val) => val.trim())
      .openapi({ example: 'Acme Corporation' }),
  })
  .strict();

export const updateOrgBodySchema = z
  .object({
    name: z
      .string()
      .min(1, 'Organization name is required')
      .max(100, 'Organization name must not exceed 100 characters')
      .transform((val) => val.trim())
      .openapi({ example: 'Acme Corp Technologies' }),
  })
  .strict();

export const orgParamsSchema = z
  .object({
    orgId: z
      .string()
      .uuid('Invalid organization ID')
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
  })
  .strict();

export const organizationResponseSchema = registry.register(
  'OrganizationResponse',
  z.object({
    organization: z.object({
      id: z.string().uuid(),
      name: z.string(),
      slug: z.string(),
      createdById: z.string().uuid(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
      role: z.string().optional(),
    }),
  }),
);

export const organizationListResponseSchema = registry.register(
  'OrganizationListResponse',
  z.object({
    organizations: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        slug: z.string(),
        createdById: z.string().uuid(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
        role: z.string(),
      }),
    ),
  }),
);

export const createOrgSchema = {
  body: createOrgBodySchema,
};

export const updateOrgSchema = {
  params: orgParamsSchema,
  body: updateOrgBodySchema,
};

export const getOrgSchema = {
  params: orgParamsSchema,
};

export type CreateOrgInput = z.infer<typeof createOrgBodySchema>;
export type UpdateOrgInput = z.infer<typeof updateOrgBodySchema>;

// OpenAPI route registrations
registry.registerPath({
  method: 'post',
  path: '/orgs',
  summary: 'Create a new organization',
  description:
    'Creates an organization with standard system roles, permissions, and owner membership atomically.',
  tags: ['Organizations'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: createOrgBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Organization created successfully',
      content: {
        'application/json': {
          schema: organizationResponseSchema,
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
  path: '/orgs',
  summary: 'List user organizations',
  description: 'Returns all organizations the authenticated user belongs to.',
  tags: ['Organizations'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'List of organizations',
      content: {
        'application/json': {
          schema: organizationListResponseSchema,
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
  path: '/orgs/{orgId}',
  summary: 'Get organization details',
  description: 'Returns organization details for a member. Non-members receive 404.',
  tags: ['Organizations'],
  security: [{ bearerAuth: [] }],
  request: {
    params: orgParamsSchema,
  },
  responses: {
    200: {
      description: 'Organization details',
      content: {
        'application/json': {
          schema: organizationResponseSchema,
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
      description: 'Organization not found (or caller not a member)',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/orgs/{orgId}',
  summary: 'Update organization',
  description: 'Updates organization details. Requires org:update permission.',
  tags: ['Organizations'],
  security: [{ bearerAuth: [] }],
  request: {
    params: orgParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: updateOrgBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Organization updated successfully',
      content: {
        'application/json': {
          schema: organizationResponseSchema,
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
