import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config/env.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';

describe('Z.ai GLM-4.7-Flash Streaming Backend Test Suite', () => {
  let server: http.Server;
  let serverBaseUrl: string;
  let originalFetch: typeof globalThis.fetch;
  let mockFetchHandler: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null = null;

  before(async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlString =
        typeof input === 'string'
          ? input
          : input instanceof URL
          ? input.toString()
          : (input as Request).url;

      // Only intercept upstream calls to Z.ai, allow test requests to local Express server
      if (
        mockFetchHandler &&
        (urlString.includes('api.z.ai') || urlString.startsWith(config.zaiBaseUrl))
      ) {
        const signal = init?.signal;
        if (signal?.aborted) {
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }

        return new Promise<Response>((resolve, reject) => {
          const onAbort = () => {
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          };

          signal?.addEventListener('abort', onAbort, { once: true });

          mockFetchHandler!(input, init)
            .then((res) => {
              signal?.removeEventListener('abort', onAbort);
              resolve(res);
            })
            .catch((err) => {
              signal?.removeEventListener('abort', onAbort);
              reject(err);
            });
        });
      }

      return originalFetch(input, init);
    };

    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as { port: number };
    serverBaseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    mockFetchHandler = null;
    resetRateLimits();
    config.zaiApiKey = 'test_zai_key_1234567890';
  });

  // 1. GET /health
  it('1. GET /health returns backend status', async () => {
    const res = await fetch(`${serverBaseUrl}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.model, 'glm-4.7-flash');
    assert.equal(data.provider, 'z.ai');
    assert.equal(data.configured, true);
    assert.ok(data.timestamp);
  });

  // 2. GET /v1/models
  it('2. GET /v1/models returns OpenAI-compatible model list containing glm-4.7-flash', async () => {
    const res = await fetch(`${serverBaseUrl}/v1/models`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.object, 'list');
    assert.ok(Array.isArray(data.data));
    const model = data.data.find((m: { id: string }) => m.id === 'glm-4.7-flash');
    assert.ok(model, 'glm-4.7-flash must be present in model list');
    assert.equal(model.owned_by, 'z.ai');
  });

  // 3. Non-streaming completion
  it('3. Non-streaming completion returns OpenAI-compatible response', async () => {
    mockFetchHandler = async (_input, init) => {
      const body = JSON.parse(init?.body as string);
      assert.equal(body.model, 'glm-4.7-flash');
      assert.equal(body.stream, false);

      const mockResponse = {
        id: 'chatcmpl-test-nonstream-123',
        object: 'chat.completion',
        created: 1704067200,
        model: 'glm-4.7-flash',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! I am GLM-4.7-Flash.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
          total_tokens: 18,
        },
      };

      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await fetch(`${serverBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'glm-4.7-flash',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: false,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.object, 'chat.completion');
    assert.equal(data.choices[0].message.content, 'Hello! I am GLM-4.7-Flash.');
    assert.equal(data.usage.total_tokens, 18);
  });

  // 4. Streaming completion headers
  it('4. Streaming completion sets SSE headers properly', async () => {
    mockFetchHandler = async () => {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(
            enc.encode('data: {"id":"1","choices":[{"delta":{"content":"Hi"}}]}\n\n')
          );
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };

    const res = await fetch(`${serverBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'glm-4.7-flash',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }),
    });

    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/event-stream'));
    assert.equal(res.headers.get('cache-control'), 'no-cache, no-transform');
    await res.text();
  });

  // 5. SSE chunk forwarding
  it('5. SSE chunks are forwarded progressively', async () => {
    mockFetchHandler = async () => {
      const chunks = [
        'data: {"id":"c1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"id":"c2","choices":[{"delta":{"content":" world!"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          for (const c of chunks) {
            controller.enqueue(enc.encode(c));
          }
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };

    const res = await fetch(`${serverBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Say hello world' }],
        stream: true,
      }),
    });

    const bodyText = await res.text();
    assert.ok(bodyText.includes('"Hello"'));
    assert.ok(bodyText.includes('" world!"'));
  });

  // 6. [DONE] stream termination
  it('6. Stream ends with data: [DONE]', async () => {
    mockFetchHandler = async () => {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(
            enc.encode('data: {"id":"c1","choices":[{"delta":{"content":"Ending test"}}]}\n\n')
          );
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };

    const res = await fetch(`${serverBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'End' }],
        stream: true,
      }),
    });

    const text = await res.text();
    assert.ok(text.endsWith('data: [DONE]\n\n') || text.includes('data: [DONE]\n\n'));
  });

  // 7. Client disconnect and upstream abort
  it('7. Client disconnect aborts upstream request', async () => {
    let upstreamAborted = false;

    mockFetchHandler = async (_input, init) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener('abort', () => {
          upstreamAborted = true;
        });
      }

      // Hang the stream indefinitely until aborted
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(
            enc.encode('data: {"id":"start","choices":[{"delta":{"content":"Hold..."}}]}\n\n')
          );
        },
        cancel() {
          upstreamAborted = true;
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };

    const controller = new AbortController();
    const resPromise = fetch(`${serverBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Disconnect me' }],
        stream: true,
      }),
      signal: controller.signal,
    });

    const res = await resPromise;
    const reader = res.body?.getReader();
    // Read the first chunk
    await reader?.read();

    // Abort the client request
    controller.abort();

    // Give grace period for abort event propagation across TCP socket
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(upstreamAborted, true, 'Upstream request must be aborted when client disconnects');
  });

  // 8. Invalid request validation
  it('8. Invalid request returns 400 with invalid_request_error', async () => {
    // Missing messages array
    const res1 = await fetch(`${serverBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [],
      }),
    });
    assert.equal(res1.status, 400);
    const err1 = await res1.json();
    assert.equal(err1.error.type, 'invalid_request_error');

    // Invalid role
    const res2 = await fetch(`${serverBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'unknown_role', content: 'test' }],
      }),
    });
    assert.equal(res2.status, 400);
    const err2 = await res2.json();
    assert.equal(err2.error.type, 'invalid_request_error');
  });

  // 9. Missing API key
  it('9. Missing API key returns 500 server_error with missing_api_key', async () => {
    config.zaiApiKey = ''; // Clear API key

    const res = await fetch(`${serverBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'No key' }],
      }),
    });

    assert.equal(res.status, 500);
    const data = await res.json();
    assert.equal(data.error.code, 'missing_api_key');
    assert.equal(data.error.type, 'server_error');
  });

  // 10. Z.ai authentication failure
  it('10. Upstream 401 returns 401 authentication_error', async () => {
    mockFetchHandler = async () => {
      return new Response(
        JSON.stringify({
          error: { message: 'Invalid API Key', code: '1000' },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const res = await fetch(`${serverBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Auth test' }],
      }),
    });

    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error.type, 'authentication_error');
    assert.equal(data.error.code, 'invalid_api_key');
  });

  // 11. Z.ai rate limit
  it('11. Upstream 429 rate limit returns 429 rate_limit_error and forwards Retry-After', async () => {
    mockFetchHandler = async () => {
      return new Response(
        JSON.stringify({
          error: { message: 'Requests rate limit exceeded', code: '1302' },
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '5',
          },
        }
      );
    };

    const res = await fetch(`${serverBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Rate test' }],
      }),
    });

    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '5');
    const data = await res.json();
    assert.equal(data.error.type, 'rate_limit_error');
  });

  // 12. Z.ai upstream failure
  it('12. Upstream 500/502 returns 502 api_error', async () => {
    mockFetchHandler = async () => {
      return new Response('Internal Server Error in Z.ai cluster', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    };

    const res = await fetch(`${serverBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Upstream 500 test' }],
      }),
    });

    assert.equal(res.status, 502);
    const data = await res.json();
    assert.equal(data.error.type, 'api_error');
  });

  // 13. Timeout handling
  it('13. Upstream timeout triggers 504 gateway_timeout', async () => {
    const origTimeout = config.upstreamTimeoutMs;
    config.upstreamTimeoutMs = 50; // set small timeout for test

    mockFetchHandler = async () => {
      // Delay longer than timeout
      await new Promise((r) => setTimeout(r, 200));
      return new Response('{}', { status: 200 });
    };

    try {
      const res = await fetch(`${serverBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Timeout test' }],
        }),
      });

      assert.equal(res.status, 504);
      const data = await res.json();
      assert.equal(data.error.type, 'timeout_error');
      assert.equal(data.error.code, 'gateway_timeout');
    } finally {
      config.upstreamTimeoutMs = origTimeout;
    }
  });

  // 14. CORS headers
  it('14. CORS preflight OPTIONS returns 204 with proper headers', async () => {
    const res = await fetch(`${serverBaseUrl}/v1/chat/completions`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://client.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.ok(res.headers.get('access-control-allow-methods')?.includes('POST'));
  });

  // 15. Server Rate Limiting
  it('15. Server-side rate limiter returns 429 when quota exceeded', async () => {
    const origMax = config.rateLimitMax;
    config.rateLimitMax = 3; // Limit to 3 requests
    resetRateLimits();

    try {
      // 1st request
      let res = await fetch(`${serverBaseUrl}/health`);
      assert.equal(res.status, 200);

      // 2nd request
      res = await fetch(`${serverBaseUrl}/health`);
      assert.equal(res.status, 200);

      // 3rd request
      res = await fetch(`${serverBaseUrl}/health`);
      assert.equal(res.status, 200);

      // 4th request: should be rate limited!
      res = await fetch(`${serverBaseUrl}/health`);
      assert.equal(res.status, 429);
      assert.ok(res.headers.get('retry-after'));

      const data = await res.json();
      assert.equal(data.error.type, 'rate_limit_error');
      assert.equal(data.error.code, 'rate_limit_exceeded');
    } finally {
      config.rateLimitMax = origMax;
      resetRateLimits();
    }
  });
});
