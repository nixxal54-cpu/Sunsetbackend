import { Request, Response, Router } from 'express';
import { config } from '../config/env.js';
import { ZAI_MODEL_ID } from '../types/zai.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'zai-glm4.7-flash-streaming-proxy',
    model: ZAI_MODEL_ID,
    provider: 'z.ai',
    configured: Boolean(config.zaiApiKey),
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});
