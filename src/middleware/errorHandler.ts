import { NextFunction, Request, Response } from 'express';
import { AppError, NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId = req.id || (res.getHeader('X-Request-Id') as string) || '';

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    });
    return;
  }

  // Handle Multer upload errors
  if (err.name === 'MulterError' || (err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
    const isOversize = (err as { code?: string }).code === 'LIMIT_FILE_SIZE';
    const statusCode = isOversize ? 413 : 400;
    const errorCode = isOversize ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR';
    const message = isOversize
      ? 'File size exceeds maximum allowed limit of 5 MB'
      : err.message || 'File upload error';

    res.status(statusCode).json({
      error: {
        code: errorCode,
        message,
        details: [],
        requestId,
      },
    });
    return;
  }

  logger.error(
    {
      err,
      requestId,
      method: req.method,
      url: req.originalUrl,
    },
    'Unhandled server error',
  );

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      details: [],
      requestId,
    },
  });
}
