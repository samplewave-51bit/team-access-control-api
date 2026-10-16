import crypto from 'crypto';
import FileType from 'file-type';
import { recordAudit } from '../../lib/audit';
import { PayloadTooLargeError, UnsupportedMediaTypeError, ValidationError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import { FileResponse } from './files.schemas';

export const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'application/pdf',
  'text/plain',
] as const;

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_ORG_QUOTA_BYTES = BigInt(50 * 1024 * 1024); // 50 MB

const DANGEROUS_EXTENSIONS = new Set([
  'php',
  'php3',
  'php4',
  'php5',
  'phtml',
  'phar',
  'exe',
  'dll',
  'bat',
  'cmd',
  'sh',
  'bash',
  'bin',
  'vbs',
  'js',
  'jar',
  'jsp',
  'asp',
  'aspx',
  'cgi',
  'pl',
  'py',
  'rb',
  'msi',
  'com',
  'scr',
  'hta',
]);

export interface UploadFileInput {
  orgId: string;
  userId: string;
  file?: Express.Multer.File;
  ip?: string;
}

export class FilesService {
  /**
   * Secure multipart file upload with validation, magic-byte inspection,
   * quota enforcement, S3 storage, and transactional audit logging.
   */
  async uploadFile(input: UploadFileInput): Promise<FileResponse> {
    const { orgId, userId, file, ip } = input;

    // 1. Verify file presence
    if (!file || !file.buffer) {
      throw new ValidationError("File is required under field 'file'");
    }

    // 2. Reject empty files
    if (file.size === 0 || file.buffer.length === 0) {
      throw new ValidationError('File cannot be empty');
    }

    // 3. Size check (max 5 MB)
    if (file.size > MAX_FILE_SIZE) {
      throw new PayloadTooLargeError('File size exceeds maximum allowed limit of 5 MB');
    }

    const rawName = file.originalname || 'unnamed-file';

    // 4. Path traversal filename check
    if (rawName.includes('..') || rawName.includes('/') || rawName.includes('\\')) {
      throw new ValidationError('Invalid filename: path traversal sequences are not allowed');
    }

    // 5. Dangerous double extension check (e.g. a.php.png)
    const nameParts = rawName.toLowerCase().split('.');
    if (nameParts.length > 2) {
      const middleExtensions = nameParts.slice(1, -1);
      const hasDangerousExt = middleExtensions.some((ext) => DANGEROUS_EXTENSIONS.has(ext));
      if (hasDangerousExt) {
        throw new ValidationError('Invalid filename: dangerous double extension detected');
      }
    }

    // 6. Sanitize originalName for safe storage & display
    // Strip control characters (ASCII 0-31, 127) and limit length to 255
    const sanitizedName = Array.from(rawName)
      .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
      .join('')
      .trim()
      .slice(0, 255);

    // 7. Check declared MIME type against allowlist
    const declaredMime = file.mimetype.toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(declaredMime as (typeof ALLOWED_MIME_TYPES)[number])) {
      throw new UnsupportedMediaTypeError(
        `Unsupported media type '${declaredMime}'. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    // 8. Magic-byte inspection via file-type
    const detectedType = await FileType.fromBuffer(file.buffer);

    if (declaredMime === 'text/plain') {
      // Plain text files do NOT have magic bytes. If a binary magic header is detected,
      // it's a binary file masquerading as text/plain.
      if (detectedType !== undefined) {
        throw new UnsupportedMediaTypeError(
          `Detected file type '${detectedType.mime}' does not match declared type '${declaredMime}'`,
        );
      }
      // Inspect for binary null bytes
      if (file.buffer.includes(0)) {
        throw new UnsupportedMediaTypeError('Binary null bytes detected in text/plain file');
      }
    } else {
      // Binary files (image/png, image/jpeg, application/pdf) MUST have valid magic bytes
      if (!detectedType) {
        throw new UnsupportedMediaTypeError(
          `Could not verify magic byte signature for file declared as '${declaredMime}'`,
        );
      }
      if (detectedType.mime !== declaredMime) {
        throw new UnsupportedMediaTypeError(
          `Detected file type '${detectedType.mime}' does not match declared type '${declaredMime}'`,
        );
      }
    }

    // 9. Compute SHA-256 hash
    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // 10. Generate safe storage key: orgs/<orgId>/<uuid> (no client extension trust)
    const fileId = crypto.randomUUID();
    const storageKey = `orgs/${orgId}/${fileId}`;

    // 11. Transactional Quota Check & File Row Creation + Audit Log
    const fileRecord = await prisma.$transaction(async (tx) => {
      // Per-org storage quota (50 MB) enforcement inside transaction
      const aggregate = await tx.file.aggregate({
        where: { orgId, deletedAt: null },
        _sum: { sizeBytes: true },
      });
      const currentQuotaBytes = aggregate._sum.sizeBytes ?? BigInt(0);

      if (currentQuotaBytes + BigInt(file.size) > MAX_ORG_QUOTA_BYTES) {
        throw new PayloadTooLargeError('Organization storage quota of 50 MB exceeded');
      }

      // Put object into S3 storage
      await storage.put({
        key: storageKey,
        body: file.buffer,
        contentType: declaredMime,
      });

      // Create File record in database
      const created = await tx.file.create({
        data: {
          id: fileId,
          orgId,
          uploadedById: userId,
          storageKey,
          originalName: sanitizedName,
          mimeType: declaredMime,
          sizeBytes: BigInt(file.size),
          sha256,
          status: 'PENDING_SCAN',
        },
      });

      // Transactional audit log entry
      await recordAudit(tx, {
        orgId,
        actorId: userId,
        action: 'file.upload',
        targetType: 'file',
        targetId: created.id,
        metadata: {
          originalName: sanitizedName,
          mimeType: declaredMime,
          sizeBytes: file.size,
          sha256,
        },
        ip,
      });

      return created;
    });

    return {
      id: fileRecord.id,
      orgId: fileRecord.orgId,
      uploadedById: fileRecord.uploadedById,
      originalName: fileRecord.originalName,
      mimeType: fileRecord.mimeType,
      sizeBytes: Number(fileRecord.sizeBytes),
      sha256: fileRecord.sha256,
      status: fileRecord.status as 'PENDING_SCAN' | 'CLEAN' | 'INFECTED' | 'FAILED',
      createdAt: fileRecord.createdAt.toISOString(),
      updatedAt: fileRecord.updatedAt.toISOString(),
    };
  }
}

export const filesService = new FilesService();
