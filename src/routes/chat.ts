import { Request, Response, Router } from 'express';
import { validateChatCompletionRequest } from '../middleware/requestValidation.js';
import { isZaiServiceError, ZaiService } from '../services/zai.js';
import { OpenAIErrorResponse } from '../types/openai.js';
import { logger } from '../utils/logger.js';
import { initSseHeaders, SSE_DONE_MESSAGE } from '../utils/sse.js';

export const chatRouter = Router();

chatRouter.post(
  '/v1/chat/completions',
  validateChatCompletionRequest,
  async (req: Request, res: Response): Promise<void> => {
    const isStream = Boolean(req.body.stream);
    const clientAbortController = new AbortController();

    // Listen for client abort / premature disconnect
    res.on('close', () => {
      if (!res.writableFinished) {
        logger.info('Client closed connection before completion finished. Aborting upstream request.');
        clientAbortController.abort();
      }
    });

    if (isStream) {
      let headersSent = false;

      try {
        const streamGenerator = ZaiService.createStreamCompletion(
          req.body,
          clientAbortController.signal
        );

        // Consume chunks progressively from Z.ai
        for await (const chunk of streamGenerator) {
          if (!headersSent) {
            initSseHeaders(res);
            headersSent = true;
          }

          if (clientAbortController.signal.aborted) {
            break;
          }

          if (chunk.isDone) {
            res.write(SSE_DONE_MESSAGE);
          } else {
            res.write(`data: ${chunk.data}\n\n`);
          }

          // If res has flush method, flush buffer
          if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
            (res as unknown as { flush: () => void }).flush();
          }
        }

        if (headersSent && !res.writableFinished) {
          res.end();
        }
      } catch (err: unknown) {
        handleChatError(err, res, headersSent);
      }
    } else {
      // Non-streaming completion
      try {
        const completion = await ZaiService.createCompletion(
          req.body,
          clientAbortController.signal
        );
        res.json(completion);
      } catch (err: unknown) {
        handleChatError(err, res, false);
      }
    }
  }
);

function handleChatError(err: unknown, res: Response, headersSent: boolean): void {
  if (isZaiServiceError(err)) {
    if (err.statusCode === 499) {
      // Client aborted connection
      if (!res.writableFinished) {
        res.end();
      }
      return;
    }

    if (err.retryAfter) {
      res.setHeader('Retry-After', err.retryAfter);
    }
    if (err.requestId) {
      res.setHeader('X-Request-ID', err.requestId);
    }

    const errorPayload: OpenAIErrorResponse = {
      error: {
        message: err.message,
        type: err.errorType,
        param: null,
        code: err.errorCode,
      },
    };

    if (headersSent) {
      // Stream was already opened; deliver error as SSE event then close
      res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
      res.write(SSE_DONE_MESSAGE);
      res.end();
    } else {
      res.status(err.statusCode).json(errorPayload);
    }
    return;
  }

  // Generic or unexpected error
  const standardMessage =
    err instanceof Error ? err.message : 'An error occurred during chat completion processing.';

  logger.error('Unexpected chat completion error:', standardMessage);

  const errorPayload: OpenAIErrorResponse = {
    error: {
      message: standardMessage,
      type: 'api_error',
      param: null,
      code: 'internal_error',
    },
  };

  if (headersSent) {
    res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
    res.write(SSE_DONE_MESSAGE);
    res.end();
  } else {
    res.status(500).json(errorPayload);
  }
}
