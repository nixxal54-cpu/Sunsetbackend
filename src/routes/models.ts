import { Request, Response, Router } from 'express';
import { OpenAIModel, OpenAIModelList } from '../types/openai.js';
import { ZAI_MODEL_ID } from '../types/zai.js';

export const modelsRouter = Router();

const glmModel: OpenAIModel = {
  id: ZAI_MODEL_ID,
  object: 'model',
  created: 1704067200,
  owned_by: 'z.ai',
  permission: [],
  root: ZAI_MODEL_ID,
  parent: null,
};

modelsRouter.get('/v1/models', (_req: Request, res: Response) => {
  const response: OpenAIModelList = {
    object: 'list',
    data: [glmModel],
  };
  res.json(response);
});

modelsRouter.get('/v1/models/:model', (req: Request, res: Response) => {
  if (req.params.model === ZAI_MODEL_ID) {
    res.json(glmModel);
    return;
  }
  res.status(404).json({
    error: {
      message: `The model '${req.params.model}' does not exist.`,
      type: 'invalid_request_error',
      param: 'model',
      code: 'model_not_found',
    },
  });
});
