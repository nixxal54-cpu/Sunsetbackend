import fs from 'fs';
import path from 'path';
import express from 'express';
import { createApp } from './src/app.js';
import { config } from './src/config/env.js';
import { logger } from './src/utils/logger.js';

async function startServer() {
  const app = createApp();
  const distPath = path.resolve(process.cwd(), 'dist');
  const distExists = fs.existsSync(path.join(distPath, 'index.html'));

  if (process.env.NODE_ENV === 'production' || distExists) {
    app.use(express.static(distPath));

    // Fallback to SPA index.html for non-API routes
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/v1') || req.path.startsWith('/health')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // Development mode with Vite dev middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    // Fallback to transform index.html for SPA routes in dev
    app.get('*', async (req, res, next) => {
      if (req.path.startsWith('/v1') || req.path.startsWith('/health')) {
        return next();
      }
      try {
        const indexPath = path.resolve(process.cwd(), 'index.html');
        let template = fs.readFileSync(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        next(e);
      }
    });
  }

  const port = config.port;
  app.listen(port, '0.0.0.0', () => {
    logger.info(`Z.ai GLM-4.7-Flash backend server running on http://0.0.0.0:${port}`);
    logger.info(`Upstream Base URL: ${config.zaiBaseUrl}`);
    logger.info(`ZAI_API_KEY status: ${config.zaiApiKey ? 'Configured (secure)' : 'NOT CONFIGURED'}`);
    logger.info(`Health check: http://localhost:${port}/health`);
    logger.info(`Models endpoint: http://localhost:${port}/v1/models`);
    logger.info(`Chat completions: http://localhost:${port}/v1/chat/completions`);
  });
}

startServer().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
