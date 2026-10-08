import { z } from 'zod';
import { errorResponseSchema, registry } from '../../docs/openapi';

export const permissionsResponseSchema = registry.register(
  'PermissionsResponse',
  z.object({
    permissions: z.array(
      z.object({
        key: z.string().openapi({ example: 'member:read' }),
        description: z.string().openapi({ example: 'List and view organization members' }),
      }),
    ),
  }),
);

// OpenAPI path registration
registry.registerPath({
  method: 'get',
  path: '/permissions',
  summary: 'List permission catalog',
  description: 'Returns the catalog of all available permissions in the system.',
  tags: ['Permissions'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'List of all system permissions',
      content: {
        'application/json': {
          schema: permissionsResponseSchema,
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
