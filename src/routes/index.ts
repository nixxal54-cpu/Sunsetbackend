import { Router } from 'express';
import { chatRouter } from './chat.js';
import { healthRouter } from './health.js';
import { modelsRouter } from './models.js';

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(modelsRouter);
apiRouter.use(chatRouter);
