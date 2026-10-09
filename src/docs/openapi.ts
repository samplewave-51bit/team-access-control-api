import {
  extendZodWithOpenApi,
  OpenApiGeneratorV3,
  OpenAPIRegistry,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// Standard Error Schema
export const errorResponseSchema = registry.register(
  'ErrorResponse',
  z.object({
    error: z.object({
      code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
      message: z.string().openapi({ example: 'Request validation failed' }),
      details: z.array(z.any()).openapi({ example: [] }),
      requestId: z.string().openapi({ example: 'c0a80164-99d9-40de-b5f6-45caa7c68809' }),
    }),
  }),
);

export function getOpenApiDocumentation() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Team Access Control API',
      description:
        'Production-style IAM-style SaaS backend with RBAC, session management, file safety, and audit logging.',
    },
    servers: [
      {
        url: '/api/v1',
        description: 'Current API version (v1)',
      },
    ],
  });
}
