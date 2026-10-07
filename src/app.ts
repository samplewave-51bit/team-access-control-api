import express, { Express, Request, Response } from 'express';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { getOpenApiDocumentation } from './docs/openapi';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestIdMiddleware } from './middleware/requestId';
import { authRouter } from './modules/auth/auth.routes';
import { healthRouter } from './modules/health/health.routes';

export function createApp(): Express {
  const app = express();

  // Basic security and parsing
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request ID middleware
  app.use(requestIdMiddleware);

  // HTTP Logging middleware
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) =>
        (req as express.Request).id || (req.headers['x-request-id'] as string) || '',
      customLogLevel: (_req, res, err) => {
        if (res.statusCode >= 500 || err) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // Swagger and OpenAPI Documentation
  const openApiDoc = getOpenApiDocumentation();
  app.get('/docs/openapi.json', (_req: Request, res: Response) => {
    res.status(200).json(openApiDoc);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));

  // API Routes
  app.use('/api/v1', healthRouter);
  app.use('/api/v1/auth', authRouter);

  // 404 handler
  app.use(notFoundHandler);

  // Central error handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
