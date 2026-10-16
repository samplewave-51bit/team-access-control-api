import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { rateLimitConfigs } from '../../config/rateLimits';
import { authenticate } from '../../middleware/authenticate';
import { createRateLimiterMiddleware } from '../../middleware/rateLimit';
import { requirePermission } from '../../middleware/requirePermission';
import { validate } from '../../middleware/validate';
import { filesController } from './files.controller';
import { fileParamsSchema } from './files.schemas';

export const filesRouter = Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },
});

/**
 * Pre-inspects raw multipart stream for path traversal sequences in Content-Disposition filename
 * before Busboy/Multer strips directory paths.
 */
function inspectMultipartFilename(req: Request, res: Response, next: NextFunction): void {
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('multipart/form-data')) {
    return next();
  }

  let inspected = false;
  const onData = (chunk: Buffer) => {
    if (inspected) return;
    inspected = true;
    req.removeListener('data', onData);
    req.pause();

    const headerSnippet = chunk.subarray(0, 2048).toString('utf8');
    const filenameMatch = /filename="([^"]+)"/i.exec(headerSnippet);
    if (filenameMatch) {
      const rawFilename = filenameMatch[1];
      if (rawFilename.includes('..') || rawFilename.includes('/') || rawFilename.includes('\\')) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid filename: path traversal sequences are not allowed',
            details: [],
            requestId: req.id || (res.getHeader('X-Request-Id') as string) || '',
          },
        });
        return;
      }
    }

    req.unshift(chunk);
    next();
  };

  req.on('data', onData);
}

filesRouter.post(
  '/',
  authenticate,
  validate({ params: fileParamsSchema }),
  requirePermission('file:upload'),
  createRateLimiterMiddleware(rateLimitConfigs.upload),
  inspectMultipartFilename,
  upload.single('file'),
  (req, res, next) => {
    filesController.upload(req, res).catch(next);
  },
);
