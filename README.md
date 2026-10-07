# Z.ai GLM-4.7-Flash Streaming Backend

A production-ready, lightweight OpenAI-compatible backend proxy designed for Z.ai's **GLM-4.7-Flash** model.

It provides real Server-Sent Events (SSE) streaming, aborts upstream requests on client disconnect, validates payloads, enforces rate limits, secures API keys server-side, and is optimized for low-resource deployment on platforms like Render, Docker, and Cloud Run.

---

## ⚡ Features

- **Strict Model Enforcement**: Always proxies to `glm-4.7-flash` via official Z.ai PaaS endpoint (`https://api.z.ai/api/paas/v4/chat/completions`). No arbitrary client model or provider redirection allowed.
- **Real SSE Streaming**: Native progressive streaming via `ReadableStream` with immediate chunk forwarding. No intermediate buffering.
- **Client Disconnect Handling**: Automatically aborts upstream Z.ai HTTP request via `AbortController` if the client closes the connection.
- **OpenAI Compatible**: Drop-in compatible with official OpenAI SDKs, LangChain, LlamaIndex, Open WebUI, and frontend streaming chat clients (`POST /v1/chat/completions`, `GET /v1/models`).
- **Production Hardened**:
  - `ZAI_API_KEY` stored exclusively server-side; never exposed to clients, never logged, and redacted from error outputs.
  - In-memory sliding window rate limiting with `Retry-After` header.
  - Strict input validation and 2MB payload limits.
  - Upstream timeout protection (default 120s).
  - Transient upstream 429/5xx retry handling with exponential backoff; never endlessly retries quota exhaustion errors.

---

## 🔑 Obtaining & Configuring the Z.ai API Key

1. Sign up or log into [Z.ai (BigModel International Platform)](https://z.ai).
2. Navigate to the **API Keys** management console (`https://z.ai` or your team dashboard).
3. Generate a new API key.
4. Set the key in your server environment:
   ```bash
   export ZAI_API_KEY="your-actual-zai-api-key"
   ```

> ⚠️ **Security Warning**: Never commit `ZAI_API_KEY` to source control. The server will reject client attempts to supply their own API keys via frontend headers.

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ZAI_API_KEY` | *(Required)* | Your secret API key from Z.ai |
| `ZAI_BASE_URL` | `https://api.z.ai/api/paas/v4` | Official Z.ai API base URL |
| `PORT` | `3000` | Port for the HTTP server to listen on |
| `ALLOWED_ORIGINS` | `*` | Comma-separated list of allowed CORS origins or `*` |
| `RATE_LIMIT_MAX` | `60` | Max requests per IP window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in ms (1 minute) |
| `UPSTREAM_TIMEOUT` | `120000` | Upstream Z.ai request timeout in ms (2 minutes) |

---

## 🚀 Local Quickstart

### 1. Installation
```bash
npm install
```

### 2. Configure Environment
Create a `.env` file from `.env.example`:
```bash
cp .env.example .env
```
Edit `.env` and fill in `ZAI_API_KEY`:
```env
ZAI_API_KEY=your_z_ai_api_key_here
PORT=3000
```

### 3. Run Development Server
```bash
npm run dev
```
The server will start at `http://localhost:3000`.

### 4. Run Test Suite
Automated test suite covering all 15 scenarios (health, models, streaming, SSE chunk forwarding, termination, aborts, timeouts, errors, and rate limits) using mocked upstream responses:
```bash
npm test
```

---

## 📡 API Endpoints

### 1. `GET /health`
Returns backend health, active model, and configuration status:
```bash
curl http://localhost:3000/health
```
**Response:**
```json
{
  "status": "ok",
  "service": "zai-glm4.7-flash-streaming-proxy",
  "model": "glm-4.7-flash",
  "provider": "z.ai",
  "configured": true,
  "uptime": 42,
  "timestamp": "2026-10-06T19:24:00.000Z",
  "version": "1.0.0"
}
```

### 2. `GET /v1/models`
Returns OpenAI-compatible model list:
```bash
curl http://localhost:3000/v1/models
```

### 3. `POST /v1/chat/completions` (Streaming via SSE)
Test progressive streaming using `curl`:
```bash
curl -N -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-4.7-flash",
    "messages": [
      {"role": "system", "content": "You are a concise programming assistant."},
      {"role": "user", "content": "Explain how SSE works in 2 sentences."}
    ],
    "stream": true,
    "temperature": 0.7
  }'
```
**Output stream:**
```text
data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant","content":"Server"},"finish_reason":null}]}

data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"-Sent Events enable unidirection..."},"finish_reason":null}]}

data: [DONE]
```

### 4. `POST /v1/chat/completions` (Non-Streaming)
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-4.7-flash",
    "messages": [
      {"role": "user", "content": "Give me 3 creative team names."}
    ],
    "stream": false
  }'
```

---

## 💻 Frontend Client Integration

### Using Official OpenAI TypeScript/JavaScript SDK
```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'proxy-handled-server-side', // Any placeholder string; backend uses ZAI_API_KEY
  dangerouslyAllowBrowser: true, // If calling from frontend browser
});

async function streamChat() {
  const stream = await client.chat.completions.create({
    model: 'glm-4.7-flash',
    messages: [{ role: 'user', content: 'Write a quicksort function in TypeScript.' }],
    stream: true,
  });

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content || '';
    process.stdout.write(token);
  }
}
```

### Using Browser Fetch (Native SSE)
```typescript
const response = await fetch('/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'glm-4.7-flash',
    messages: [{ role: 'user', content: 'Hello!' }],
    stream: true,
  }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder('utf-8');

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunkText = decoder.decode(value);
  // Parse lines starting with "data: "
}
```

---

## 🚢 Deployment

### Deploy to Render
This repository includes a `render.yaml` configuration.
1. Connect your Git repository in the [Render Dashboard](https://dashboard.render.com).
2. Choose **Blueprint** and select this repository.
3. In the Render service settings, add the Environment Variable:
   - `ZAI_API_KEY`: `<your_z_ai_key>`
4. Deploy!

### Deploy via Docker
```bash
# Build Docker image
docker build -t zai-glm4-backend .

# Run container
docker run -d \
  -p 3000:3000 \
  -e ZAI_API_KEY="your-api-key" \
  --name zai-backend \
  zai-glm4-backend
```

---

## 🛡️ Error Handling Reference

Errors adhere to the OpenAI error envelope:
```json
{
  "error": {
    "message": "Detailed error message",
    "type": "invalid_request_error | authentication_error | rate_limit_error | insufficient_quota | timeout_error | api_error | server_error",
    "param": null,
    "code": "error_identifier_code"
  }
}
```

- **400 Bad Request**: Malformed body, missing messages, or invalid message schema.
- **401 Unauthorized**: Upstream Z.ai credentials rejected (`invalid_api_key`).
- **429 Rate Limit**: Too many requests locally or from Z.ai; includes `Retry-After`.
- **429 Insufficient Quota**: Account balance or credit exhausted (`insufficient_quota`).
- **504 Gateway Timeout**: Upstream Z.ai did not reply within `UPSTREAM_TIMEOUT`.
- **500 Server Error**: Server missing `ZAI_API_KEY`.
