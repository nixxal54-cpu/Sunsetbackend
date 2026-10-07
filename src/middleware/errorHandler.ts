import { Request, Response, NextFunction } from 'express';
import { OpenAIErrorResponse } from '../types/openai.js';
import { logger } from '../utils/logger.js';

interface CustomError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  code?: string;
}

export function errorHandler(
  err: CustomError,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // If response headers have already been sent (e.g. midway through an SSE stream),
  // delegate to default express handler to close socket
  if (res.headersSent) {
    logger.warn('Error occurred after headers were sent:', err.message);
    res.end();
    return;
  }

  const statusCode = err.statusCode || err.status || 500;
  let errorType: OpenAIErrorResponse['error']['type'] = 'api_error';
  let errorCode: string | null = err.code || null;
  let message = err.message || 'An internal server error occurred.';

  // Handle express.json() payload limits
  if (err.type === 'entity.too.large') {
    errorType = 'invalid_request_error';
    errorCode = 'payload_too_large';
    message = 'Request body size exceeds the allowed limit.';
  } else if (err instanceof SyntaxError && 'body' in err) {
    errorType = 'invalid_request_error';
    errorCode = 'malformed_json';
    message = 'Malformed JSON in request body.';
  } else if (statusCode >= 500) {
    errorType = 'server_error';
    // Do not leak stack traces or internal secrets in 500 responses
    logger.error('Internal server error:', err.message);
    message = 'Internal server error occurred.';
  }

  const payload: OpenAIErrorResponse = {
    error: {
      message,
      type: errorType,
      param: null,
      code: errorCode,
    },
  };

  res.status(statusCode).json(payload);
}
