/**
 * Z.ai specific types and structures
 */

import { ChatCompletionRequest } from './openai.js';

export const ZAI_MODEL_ID = 'glm-4.7-flash';
export const DEFAULT_ZAI_BASE_URL = 'https://api.z.ai/api/paas/v4';

export interface ZaiStreamChunk {
  id?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index: number;
    delta?: {
      role?: 'assistant';
      content?: string | null;
      tool_calls?: unknown[];
    };
    finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: {
    code: string | number;
    message: string;
  };
}

export interface ZaiErrorPayload {
  error?: {
    code?: string | number;
    message?: string;
    type?: string;
  };
  code?: string | number;
  message?: string;
  msg?: string;
}

export interface ZaiClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

export interface ForwardOptions {
  body: ChatCompletionRequest;
  signal?: AbortSignal;
}
