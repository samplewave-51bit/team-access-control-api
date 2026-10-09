import { z } from 'zod';
import { errorResponseSchema, registry } from '../../docs/openapi';

export const roleOrgParamsSchema = z
  .object({
    orgId: z
      .string()
      .uuid('Invalid organization ID')
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
  })
  .strict();

export const roleIdParamsSchema = z
  .object({
    orgId: z
      .string()
      .uuid('Invalid organization ID')
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    roleId: z
      .string()
      .uuid('Invalid role ID')
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174001' }),
  })
  .strict();

export const createRoleBodySchema = z
  .object({
    name: z
      .string()
      .min(1, 'Role name is required')
      .max(50, 'Role name must not exceed 50 characters')
      .transform((val) => val.trim())
      .openapi({ example: 'support_tier_1' }),
    priority: z
      .number()
      .int('Priority must be an integer')
      .min(1, 'Priority must be at least 1')
      .max(99, 'Priority cannot exceed 99')
      .openapi({ example: 40 }),
    permissions: z
      .array(z.string().min(1, 'Permission key cannot be empty'))
      .openapi({ example: ['member:read', 'role:read'] }),
  })
  .strict();

export const updateRoleBodySchema = z
  .object({
    name: z
      .string()
      .min(1, 'Role name is required')
      .max(50, 'Role name must not exceed 50 characters')
      .transform((val) => val.trim())
      .optional()
      .openapi({ example: 'support_tier_2' }),
    priority: z
      .number()
      .int('Priority must be an integer')
      .min(1, 'Priority must be at least 1')
      .max(99, 'Priority cannot exceed 99')
      .optional()
      .openapi({ example: 45 }),
    permissions: z
      .array(z.string().min(1, 'Permission key cannot be empty'))
      .optional()
      .openapi({ example: ['member:read', 'role:read', 'session:revoke'] }),
  })
  .strict()
  .refine(
    (data) =>
      data.name !== undefined || data.priority !== undefined || data.permissions !== undefined,
    { message: 'At least one field (name, priority, permissions) must be provided for update' },
  );

export const roleItemSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  priority: z.number().int(),
  isSystem: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  permissions: z.array(z.string()),
});

export const roleResponseSchema = registry.register(
  'RoleResponse',
  z.object({
    role: roleItemSchema,
  }),
);

export const rolesListResponseSchema = registry.register(
  'RolesListResponse',
  z.object({
    roles: z.array(roleItemSchema),
  }),
);

export const deleteRoleResponseSchema = registry.register(
  'DeleteRoleResponse',
  z.object({
    message: z.string(),
  }),
);

export const getRolesSchema = {
  params: roleOrgParamsSchema,
};

export const createRoleSchema = {
  params: roleOrgParamsSchema,
  body: createRoleBodySchema,
};

export const updateRoleSchema = {
  params: roleIdParamsSchema,
  body: updateRoleBodySchema,
};

export const deleteRoleSchema = {
  params: roleIdParamsSchema,
};

export type CreateRoleInput = z.infer<typeof createRoleBodySchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleBodySchema>;

// OpenAPI route registrations
registry.registerPath({
  method: 'get',
  path: '/orgs/{orgId}/roles',
  summary: 'List organization roles',
  description:
    'Returns all system and custom roles with permissions for the organization. Requires role:read permission.',
  tags: ['Roles'],
  security: [{ bearerAuth: [] }],
  request: {
    params: roleOrgParamsSchema,
  },
  responses: {
    200: {
      description: 'List of organization roles',
      content: { 'application/json': { schema: rolesListResponseSchema } },
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
  method: 'post',
  path: '/orgs/{orgId}/roles',
  summary: 'Create custom role',
  description:
    'Creates a new custom role with assigned permissions. Priority must be strictly lower than creator priority. Requires role:manage permission.',
  tags: ['Roles'],
  security: [{ bearerAuth: [] }],
  request: {
    params: roleOrgParamsSchema,
    body: {
      content: { 'application/json': { schema: createRoleBodySchema } },
    },
  },
  responses: {
    201: {
      description: 'Custom role created successfully',
      content: { 'application/json': { schema: roleResponseSchema } },
    },
    400: {
      description: 'Validation failed or invalid permission keys',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'Forbidden - Privilege escalation or priority too high',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Organization not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'Role name already exists in organization',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/orgs/{orgId}/roles/{roleId}',
  summary: 'Update custom role',
  description:
    'Updates a custom role. System roles cannot be modified. Priority must be lower than creator priority. Requires role:manage permission.',
  tags: ['Roles'],
  security: [{ bearerAuth: [] }],
  request: {
    params: roleIdParamsSchema,
    body: {
      content: { 'application/json': { schema: updateRoleBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Custom role updated successfully',
      content: { 'application/json': { schema: roleResponseSchema } },
    },
    400: {
      description: 'Validation failed or invalid permission keys',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'Forbidden - System role, priority violation, or privilege escalation',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Role or organization not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'Role name already exists in organization',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/orgs/{orgId}/roles/{roleId}',
  summary: 'Delete custom role',
  description:
    'Deletes a custom role. Cannot delete system roles or roles that have active members. Requires role:manage permission.',
  tags: ['Roles'],
  security: [{ bearerAuth: [] }],
  request: {
    params: roleIdParamsSchema,
  },
  responses: {
    200: {
      description: 'Role deleted successfully',
      content: { 'application/json': { schema: deleteRoleResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'Forbidden - Cannot delete system role or role with higher/equal priority',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Role or organization not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'Conflict - Role currently has members',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
