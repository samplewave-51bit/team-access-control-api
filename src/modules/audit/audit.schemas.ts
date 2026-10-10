import { z } from 'zod';
import { errorResponseSchema, registry } from '../../docs/openapi';

export const orgAuditParamsSchema = z
  .object({
    orgId: z
      .string()
      .uuid('Invalid organization ID')
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
  })
  .strict();

export const listAuditLogsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ example: 20 }),
    cursor: z
      .string()
      .uuid()
      .optional()
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174001' }),
    action: z.string().optional().openapi({ example: 'member.role_update' }),
    actorId: z
      .string()
      .uuid()
      .optional()
      .openapi({ example: '123e4567-e89b-12d3-a456-426614174002' }),
    from: z.string().datetime().optional().openapi({ example: '2026-10-01T00:00:00Z' }),
    to: z.string().datetime().optional().openapi({ example: '2026-10-31T23:59:59Z' }),
  })
  .strict();

export const auditLogItemSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid().nullable(),
  actorId: z.string().uuid().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  ip: z.string().nullable(),
  createdAt: z.string().datetime(),
  actor: z
    .object({
      id: z.string().uuid(),
      email: z.string().email(),
      name: z.string(),
    })
    .nullable()
    .optional(),
});

export const auditLogsListResponseSchema = registry.register(
  'AuditLogsListResponse',
  z.object({
    auditLogs: z.array(auditLogItemSchema),
    pagination: z.object({
      nextCursor: z.string().uuid().nullable(),
      hasNextPage: z.boolean(),
    }),
  }),
);

export const listAuditLogsSchema = {
  params: orgAuditParamsSchema,
  query: listAuditLogsQuerySchema,
};

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

// OpenAPI route registration
registry.registerPath({
  method: 'get',
  path: '/orgs/{orgId}/audit-logs',
  summary: 'List organization audit logs',
  description:
    'Returns queryable append-only audit trail logs with filtering and pagination. Requires audit:read permission.',
  tags: ['Audit Logs'],
  security: [{ bearerAuth: [] }],
  request: {
    params: orgAuditParamsSchema,
    query: listAuditLogsQuerySchema,
  },
  responses: {
    200: {
      description: 'List of audit log events',
      content: { 'application/json': { schema: auditLogsListResponseSchema } },
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
