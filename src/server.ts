import { Server } from 'http';
import { app } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';

let server: Server;

function startServer(): void {
  server = app.listen(env.PORT, () => {
    logger.info(`Server started and listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
  });

  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    if (server) {
      server.close((err) => {
        if (err) {
          logger.error({ err }, 'Error during server close');
          process.exit(1);
        }
        logger.info('HTTP server closed successfully');
        process.exit(0);
      });

      // Force shutdown after timeout
      setTimeout(() => {
        logger.error('Forced shutdown due to timeout');
        process.exit(1);
      }, 10000).unref();
    } else {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();
