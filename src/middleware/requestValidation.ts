import { Request, Response, NextFunction } from 'express';
import { OpenAIErrorResponse } from '../types/openai.js';

const VALID_ROLES = new Set(['system', 'user', 'assistant', 'tool', 'function']);

export function validateChatCompletionRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const errorPayload: OpenAIErrorResponse = {
      error: {
        message: 'Request body must be a valid JSON object.',
        type: 'invalid_request_error',
        param: null,
        code: 'bad_request_body',
      },
    };
    res.status(400).json(errorPayload);
    return;
  }

  // Validate messages
  if (!body.messages || !Array.isArray(body.messages)) {
    const errorPayload: OpenAIErrorResponse = {
      error: {
        message: "Missing or invalid 'messages' field. It must be an array of message objects.",
        type: 'invalid_request_error',
        param: 'messages',
        code: 'invalid_messages',
      },
    };
    res.status(400).json(errorPayload);
    return;
  }

  if (body.messages.length === 0) {
    const errorPayload: OpenAIErrorResponse = {
      error: {
        message: "'messages' array cannot be empty.",
        type: 'invalid_request_error',
        param: 'messages',
        code: 'empty_messages',
      },
    };
    res.status(400).json(errorPayload);
    return;
  }

  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    if (!msg || typeof msg !== 'object') {
      const errorPayload: OpenAIErrorResponse = {
        error: {
          message: `Message at index ${i} is not a valid object.`,
          type: 'invalid_request_error',
          param: `messages[${i}]`,
          code: 'invalid_message_item',
        },
      };
      res.status(400).json(errorPayload);
      return;
    }

    if (!msg.role || !VALID_ROLES.has(msg.role)) {
      const errorPayload: OpenAIErrorResponse = {
        error: {
          message: `Message at index ${i} has invalid role '${msg.role}'. Must be one of: system, user, assistant, tool, function.`,
          type: 'invalid_request_error',
          param: `messages[${i}].role`,
          code: 'invalid_role',
        },
      };
      res.status(400).json(errorPayload);
      return;
    }

    // Role tool requires tool_call_id
    if (msg.role === 'tool' && !msg.tool_call_id) {
      const errorPayload: OpenAIErrorResponse = {
        error: {
          message: `Message at index ${i} has role 'tool' but is missing required 'tool_call_id'.`,
          type: 'invalid_request_error',
          param: `messages[${i}].tool_call_id`,
          code: 'missing_tool_call_id',
        },
      };
      res.status(400).json(errorPayload);
      return;
    }
  }

  // Validate optional numeric parameters
  if (body.temperature !== undefined) {
    const temp = Number(body.temperature);
    if (isNaN(temp) || temp < 0 || temp > 2) {
      const errorPayload: OpenAIErrorResponse = {
        error: {
          message: "'temperature' must be a number between 0 and 2.",
          type: 'invalid_request_error',
          param: 'temperature',
          code: 'invalid_parameter',
        },
      };
      res.status(400).json(errorPayload);
      return;
    }
  }

  if (body.top_p !== undefined) {
    const topP = Number(body.top_p);
    if (isNaN(topP) || topP < 0 || topP > 1) {
      const errorPayload: OpenAIErrorResponse = {
        error: {
          message: "'top_p' must be a number between 0 and 1.",
          type: 'invalid_request_error',
          param: 'top_p',
          code: 'invalid_parameter',
        },
      };
      res.status(400).json(errorPayload);
      return;
    }
  }

  if (body.max_tokens !== undefined) {
    const maxTokens = Number(body.max_tokens);
    if (isNaN(maxTokens) || maxTokens <= 0 || !Number.isInteger(maxTokens)) {
      const errorPayload: OpenAIErrorResponse = {
        error: {
          message: "'max_tokens' must be a positive integer.",
          type: 'invalid_request_error',
          param: 'max_tokens',
          code: 'invalid_parameter',
        },
      };
      res.status(400).json(errorPayload);
      return;
    }
  }

  next();
}
