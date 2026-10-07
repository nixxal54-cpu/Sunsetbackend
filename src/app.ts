import express, { Express } from 'express';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { apiRouter } from './routes/index.js';

export function createApp(): Express {
  const app = express();

  // Disable x-powered-by header
  app.disable('x-powered-by');

  // Trust proxy for reverse proxies (Render, Cloud Run, Nginx)
  app.set('trust proxy', 1);

  // CORS middleware
  app.use(corsMiddleware);

  // Rate limiting middleware
  app.use(rateLimitMiddleware);

  // Body parser with 2MB limit
  app.use(express.json({ limit: '2mb' }));

  // Mount API endpoints
  app.use(apiRouter);

  // Central error handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
