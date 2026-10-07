import { Response } from 'express';

/**
 * Configure response headers for Server-Sent Events (SSE).
 * Disables intermediate buffering (Nginx / Cloudflare / Render reverse proxy).
 */
export function initSseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);

  if (typeof (res as unknown as { flushHeaders?: () => void }).flushHeaders === 'function') {
    (res as unknown as { flushHeaders: () => void }).flushHeaders();
  }
}

/**
 * Format a string or JSON payload into an SSE data packet.
 */
export function formatSseData(data: string | object): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `data: ${payload}\n\n`;
}

/**
 * Format the stream termination event standard in OpenAI specification.
 */
export const SSE_DONE_MESSAGE = 'data: [DONE]\n\n';

/**
 * Asynchronous SSE stream parser generator.
 * Takes a ReadableStream<Uint8Array> (from native fetch response.body)
 * and yields parsed SSE lines / data strings progressively without complete buffering.
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<{ raw: string; data: string; isDone: boolean }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      // Keep incomplete trailing line in buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) {
          // Empty line or SSE comment (heartbeat)
          continue;
        }

        if (trimmed.startsWith('data:')) {
          const dataContent = trimmed.slice(5).trim();
          const isDone = dataContent === '[DONE]';
          yield {
            raw: line,
            data: dataContent,
            isDone,
          };
        }
      }
    }

    // Flush any remaining line in buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data:')) {
        const dataContent = trimmed.slice(5).trim();
        yield {
          raw: buffer,
          data: dataContent,
          isDone: dataContent === '[DONE]',
        };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
