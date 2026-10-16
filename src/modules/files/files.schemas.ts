import { z } from 'zod';
import { registry } from '../../docs/openapi';

export const fileParamsSchema = z
  .object({
    orgId: z.string().uuid('Invalid organization ID format'),
  })
  .strict();

export const fileResponseSchema = z
  .object({
    id: z.string().uuid(),
    orgId: z.string().uuid(),
    uploadedById: z.string().uuid(),
    originalName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string(),
    status: z.enum(['PENDING_SCAN', 'CLEAN', 'INFECTED', 'FAILED']),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('FileResponse');

export const uploadFileSuccessSchema = z
  .object({
    file: fileResponseSchema,
  })
  .openapi('UploadFileResponse');

export type FileResponse = z.infer<typeof fileResponseSchema>;

// Register OpenAPI operation for POST /orgs/{orgId}/files
registry.registerPath({
  method: 'post',
  path: '/api/v1/orgs/{orgId}/files',
  tags: ['Files'],
  summary: 'Upload file to organization',
  description:
    'Secure multipart file upload with magic-byte verification, SHA-256 hashing, and per-org quota enforcement.',
  security: [{ bearerAuth: [] }],
  request: {
    params: fileParamsSchema,
    body: {
      description: 'Multipart form data containing a single file under key "file" (max 5 MB)',
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {
              file: {
                type: 'string',
                format: 'binary',
                description: 'File binary (PNG, JPEG, PDF, TXT up to 5 MB)',
              },
            },
            required: ['file'],
          },
        },
      },
    },
  },
  responses: {
    201: {
      description: 'File uploaded successfully (status PENDING_SCAN)',
      content: {
        'application/json': {
          schema: uploadFileSuccessSchema,
        },
      },
    },
    400: {
      description: 'Invalid input or filename violation',
    },
    401: {
      description: 'Unauthenticated caller',
    },
    403: {
      description: 'Missing file:upload permission',
    },
    404: {
      description: 'Organization not found or caller not a member',
    },
    413: {
      description: 'Payload too large (file exceeds 5 MB or org storage quota exceeded)',
    },
    415: {
      description: 'Unsupported media type or magic-byte signature mismatch',
    },
    429: {
      description: 'Rate limit exceeded',
    },
  },
});
