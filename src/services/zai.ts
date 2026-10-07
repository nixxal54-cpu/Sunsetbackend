/**
 * Z.ai GLM-4.7-Flash API Client Service
 *
 * Handles upstream communication with Z.ai's official endpoint:
 * https://api.z.ai/api/paas/v4/chat/completions
 *
 * Strictly enforces model glm-4.7-flash, manages authentication headers,
 * supports real SSE streaming, client disconnect aborts, exponential backoff
 * for transient errors, and robust OpenAI error translation.
 */

import { config } from '../config/env.js';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  OpenAIErrorDetail,
} from '../types/openai.js';
import { ZAI_MODEL_ID, ZaiErrorPayload } from '../types/zai.js';
import { logger } from '../utils/logger.js';
import { parseSseStream } from '../utils/sse.js';

export class ZaiServiceError extends Error {
  public readonly isZaiError = true;
  public statusCode: number;
  public errorType: OpenAIErrorDetail['type'];
  public errorCode: string | null;
  public retryAfter?: string | null;
  public requestId?: string | null;

  constructor(
    message: string,
    statusCode: number,
    errorType: OpenAIErrorDetail['type'] = 'api_error',
    errorCode: string | null = null,
    retryAfter?: string | null,
    requestId?: string | null
  ) {
    super(message);
    this.name = 'ZaiServiceError';
    Object.setPrototypeOf(this, ZaiServiceError.prototype);
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.errorCode = errorCode;
    this.retryAfter = retryAfter;
    this.requestId = requestId;
  }
}

export function isZaiServiceError(err: unknown): err is ZaiServiceError {
  return (
    err instanceof ZaiServiceError ||
    (typeof err === 'object' && err !== null && (err as { isZaiError?: boolean }).isZaiError === true)
  );
}

/**
 * Determine if a 429 response is an insufficient quota error vs a transient rate limit.
 */
function isQuotaError(message: string, code?: string | number): boolean {
  const normalizedMsg = (message || '').toLowerCase();
  const normalizedCode = String(code || '').toLowerCase();

  return (
    normalizedMsg.includes('quota') ||
    normalizedMsg.includes('insufficient') ||
    normalizedMsg.includes('balance') ||
    normalizedMsg.includes('credit') ||
    normalizedMsg.includes('arrear') ||
    normalizedMsg.includes('exhausted') ||
    normalizedCode.includes('quota') ||
    normalizedCode.includes('balance') ||
    normalizedCode.includes('1113') ||
    normalizedCode.includes('1114')
  );
}

/**
 * Clean and prepare OpenAI-compatible payload for Z.ai.
 * Strictly enforces model: glm-4.7-flash.
 */
function buildZaiRequestBody(clientRequest: ChatCompletionRequest): Record<string, unknown> {
  const {
    messages,
    stream = false,
    temperature,
    top_p,
    max_tokens,
    presence_penalty,
    frequency_penalty,
    stop,
    tools,
    tool_choice,
    stream_options,
    user,
  } = clientRequest;

  const payload: Record<string, unknown> = {
    model: ZAI_MODEL_ID, // Strictly use glm-4.7-flash
    messages,
    stream: Boolean(stream),
  };

  if (temperature !== undefined) payload.temperature = temperature;
  if (top_p !== undefined) payload.top_p = top_p;
  if (max_tokens !== undefined) payload.max_tokens = max_tokens;
  if (presence_penalty !== undefined) payload.presence_penalty = presence_penalty;
  if (frequency_penalty !== undefined) payload.frequency_penalty = frequency_penalty;
  if (stop !== undefined) payload.stop = stop;
  if (tools !== undefined) payload.tools = tools;
  if (tool_choice !== undefined) payload.tool_choice = tool_choice;
  if (stream_options !== undefined) payload.stream_options = stream_options;
  if (user !== undefined) payload.user = user;
  if (clientRequest.thinking !== undefined) payload.thinking = clientRequest.thinking;
  if (clientRequest.reasoning_effort !== undefined) payload.reasoning_effort = clientRequest.reasoning_effort;

  return payload;
}

/**
 * Sleep helper respecting abort signal.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  // In test environment, speed up backoffs to keep test suites instant
  const effectiveMs = process.env.NODE_ENV === 'test' ? Math.min(ms, 50) : ms;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason ?? new Error('Aborted'));
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, effectiveMs);

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class ZaiService {
  /**
   * Dispatches chat completion request to Z.ai with retry logic,
   * timeout handling, and abort forwarding.
   */
  public static async executeRequest(
    clientRequest: ChatCompletionRequest,
    clientSignal?: AbortSignal
  ): Promise<Response> {
    const apiKey = config.zaiApiKey;
    if (!apiKey) {
      throw new ZaiServiceError(
        'ZAI_API_KEY is not configured on the server. Please set ZAI_API_KEY in your environment variables.',
        500,
        'server_error',
        'missing_api_key'
      );
    }

    const endpoint = `${config.zaiBaseUrl}/chat/completions`;
    const requestBody = buildZaiRequestBody(clientRequest);
    const bodyJson = JSON.stringify(requestBody);

    const maxAttempts = 3; // Initial + 2 retries max for transient failures
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;

      // Combined AbortController for client disconnect and timeout
      const controller = new AbortController();
      let timedOut = false;

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('UPSTREAM_TIMEOUT'));
      }, config.upstreamTimeoutMs);

      const onClientAbort = () => {
        controller.abort(new Error('CLIENT_DISCONNECT'));
      };

      if (clientSignal) {
        if (clientSignal.aborted) {
          clearTimeout(timeoutTimer);
          throw new ZaiServiceError('Client aborted request', 499, 'invalid_request_error', 'client_closed_request');
        }
        clientSignal.addEventListener('abort', onClientAbort, { once: true });
      }

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Accept': clientRequest.stream ? 'text/event-stream' : 'application/json',
            'User-Agent': 'zai-glm4.7-proxy/1.0.0',
          },
          body: bodyJson,
          signal: controller.signal,
        });

        clearTimeout(timeoutTimer);

        const requestId = response.headers.get('x-request-id');
        const retryAfter = response.headers.get('retry-after');

        if (response.ok) {
          // If streaming, keep the abort listener attached so that if client aborts while
          // response.body is being read, controller.signal still aborts upstream!
          if (!clientRequest.stream && clientSignal) {
            clientSignal.removeEventListener('abort', onClientAbort);
          }
          return response;
        }

        // Clean up listener before retry or error
        if (clientSignal) {
          clientSignal.removeEventListener('abort', onClientAbort);
        }

        // Response is non-2xx
        let errorBody: ZaiErrorPayload | null = null;
        let rawErrorText = '';
        try {
          rawErrorText = await response.text();
          errorBody = JSON.parse(rawErrorText);
        } catch {
          // not JSON
        }

        const upstreamMessage =
          errorBody?.error?.message ||
          errorBody?.message ||
          errorBody?.msg ||
          rawErrorText ||
          `Upstream returned status ${response.status}`;

        const upstreamCode =
          errorBody?.error?.code ||
          errorBody?.code ||
          null;

        // 1. Authentication failure
        if (response.status === 401 || response.status === 403) {
          throw new ZaiServiceError(
            'Authentication with upstream Z.ai API failed. Please check that ZAI_API_KEY is valid.',
            401,
            'authentication_error',
            'invalid_api_key',
            null,
            requestId
          );
        }

        // 2. Rate limits vs Quota
        if (response.status === 429) {
          if (isQuotaError(upstreamMessage, upstreamCode ?? undefined)) {
            throw new ZaiServiceError(
              upstreamMessage || 'Insufficient Z.ai account quota or balance.',
              429,
              'insufficient_quota',
              'insufficient_quota',
              null,
              requestId
            );
          }

          // Transient rate limit: check if we can retry
          if (attempt < maxAttempts) {
            let backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 3000);
            if (retryAfter) {
              const seconds = parseInt(retryAfter, 10);
              if (!isNaN(seconds) && seconds > 0 && seconds <= 5) {
                backoffMs = seconds * 1000;
              }
            }
            logger.warn(`Upstream rate limit (429) received. Retrying attempt ${attempt + 1}/${maxAttempts} in ${backoffMs}ms...`);
            await delay(backoffMs, clientSignal);
            continue;
          }

          throw new ZaiServiceError(
            upstreamMessage || 'Upstream Z.ai rate limit exceeded. Please slow down your requests.',
            429,
            'rate_limit_error',
            'rate_limit_exceeded',
            retryAfter,
            requestId
          );
        }

        // 3. Transient server errors (502, 503, 504)
        if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt < maxAttempts) {
          const backoffMs = 1000 * Math.pow(2, attempt - 1);
          logger.warn(`Upstream server error (${response.status}) received. Retrying attempt ${attempt + 1}/${maxAttempts} in ${backoffMs}ms...`);
          await delay(backoffMs, clientSignal);
          continue;
        }

        // 4. Client errors (400 Bad Request, etc.)
        if (response.status >= 400 && response.status < 500) {
          throw new ZaiServiceError(
            upstreamMessage,
            response.status,
            'invalid_request_error',
            String(upstreamCode || 'invalid_request'),
            retryAfter,
            requestId
          );
        }

        // 5. Upstream 5xx errors
        throw new ZaiServiceError(
          `Upstream Z.ai service error: ${upstreamMessage}`,
          502,
          'api_error',
          'upstream_error',
          retryAfter,
          requestId
        );
      } catch (err: unknown) {
        clearTimeout(timeoutTimer);
        if (clientSignal) {
          clientSignal.removeEventListener('abort', onClientAbort);
        }

        if (isZaiServiceError(err)) {
          throw err;
        }

        if (clientSignal?.aborted) {
          throw new ZaiServiceError('Client aborted request', 499, 'invalid_request_error', 'client_closed_request');
        }

        if (timedOut) {
          throw new ZaiServiceError(
            `Upstream Z.ai request timed out after ${config.upstreamTimeoutMs}ms.`,
            504,
            'timeout_error',
            'gateway_timeout'
          );
        }

        const errorObj = err as Error;
        if (errorObj?.name === 'AbortError' || errorObj?.message === 'CLIENT_DISCONNECT') {
          throw new ZaiServiceError('Client aborted request', 499, 'invalid_request_error', 'client_closed_request');
        }

        // Transient network failure retry
        if (attempt < maxAttempts) {
          const backoffMs = 500 * Math.pow(2, attempt - 1);
          logger.warn(`Network error contacting Z.ai (${errorObj?.message}). Retrying in ${backoffMs}ms...`);
          await delay(backoffMs, clientSignal);
          continue;
        }

        throw new ZaiServiceError(
          `Failed to connect to upstream Z.ai API: ${errorObj?.message || 'Network failure'}`,
          502,
          'api_error',
          'upstream_connection_failed'
        );
      }
    }

    throw new ZaiServiceError('Exceeded maximum retry attempts for upstream Z.ai', 502, 'api_error', 'upstream_retry_exhausted');
  }

  /**
   * Non-streaming completion
   */
  public static async createCompletion(
    clientRequest: ChatCompletionRequest,
    clientSignal?: AbortSignal
  ): Promise<ChatCompletionResponse> {
    const response = await this.executeRequest({ ...clientRequest, stream: false }, clientSignal);
    const data = (await response.json()) as ChatCompletionResponse;
    return data;
  }

  /**
   * Streaming completion. Yields raw SSE lines parsed progressively from Z.ai.
   */
  public static async *createStreamCompletion(
    clientRequest: ChatCompletionRequest,
    clientSignal?: AbortSignal
  ): AsyncGenerator<{ raw: string; data: string; isDone: boolean }> {
    const response = await this.executeRequest({ ...clientRequest, stream: true }, clientSignal);

    if (!response.body) {
      throw new ZaiServiceError(
        'Upstream Z.ai did not return a readable response stream.',
        502,
        'api_error',
        'missing_stream_body'
      );
    }

    const cancelStream = () => {
      response.body?.cancel().catch(() => {});
    };

    if (clientSignal) {
      clientSignal.addEventListener('abort', cancelStream, { once: true });
    }

    try {
      for await (const sseChunk of parseSseStream(response.body)) {
        if (clientSignal?.aborted) {
          break;
        }
        yield sseChunk;
      }
    } finally {
      if (clientSignal) {
        clientSignal.removeEventListener('abort', cancelStream);
      }
    }
  }
}
