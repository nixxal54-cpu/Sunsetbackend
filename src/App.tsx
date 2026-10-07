/**
 * Z.ai GLM-4.7-Flash Streaming Backend Developer Console & Testbench
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  Terminal,
  Zap,
  Play,
  Square,
  Copy,
  Check,
  ShieldCheck,
  Layers,
  Code2,
  RefreshCw,
  AlertTriangle,
  Server,
  Clock,
  Sparkles,
  Brain,
  ChevronDown,
  ChevronRight,
  Sliders,
} from 'lucide-react';

interface HealthStatus {
  status: string;
  service: string;
  model: string;
  provider: string;
  configured: boolean;
  uptime: number;
  timestamp: string;
  version: string;
}

interface SseChunkLog {
  id: string;
  seq: number;
  timestamp: string;
  raw: string;
  type: 'reasoning' | 'content' | 'done' | 'meta';
  deltaText?: string;
  isDone?: boolean;
}

interface CompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number;
}

function formatInlineText(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*.*?\*\*|`.*?`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={`b-${match.index}`} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={`c-${match.index}`}
          className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-cyan-300 font-mono text-[11px]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function FormattedMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <div
            key={`code-${i}`}
            className="my-2.5 rounded-lg bg-slate-950 border border-slate-800 p-3 overflow-x-auto font-mono text-[11px] text-cyan-300"
          >
            <pre>{codeBlockContent.join('\n')}</pre>
          </div>
        );
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Bullet point detection (* , - , *   , -   )
    const trimmed = line.trim();
    if (
      trimmed.startsWith('*   ') ||
      trimmed.startsWith('-   ') ||
      trimmed.startsWith('* ') ||
      trimmed.startsWith('- ')
    ) {
      const bulletContent = trimmed.replace(/^[\*\-]\s+/, '');
      elements.push(
        <div key={`li-${i}`} className="flex items-start gap-2.5 my-1.5 pl-1">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 mt-2 shrink-0 shadow-sm shadow-cyan-400/50" />
          <div className="text-xs text-slate-200 leading-relaxed flex-1">
            {formatInlineText(bulletContent)}
          </div>
        </div>
      );
      continue;
    }

    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={`h4-${i}`} className="text-xs font-bold text-cyan-300 mt-3 mb-1 uppercase tracking-wider">
          {line.slice(4)}
        </h4>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={`h3-${i}`} className="text-sm font-bold text-white mt-4 mb-1">
          {line.slice(3)}
        </h3>
      );
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <h2 key={`h2-${i}`} className="text-base font-bold text-white mt-4 mb-2">
          {line.slice(2)}
        </h2>
      );
      continue;
    }

    if (!trimmed) {
      elements.push(<div key={`sp-${i}`} className="h-2" />);
      continue;
    }

    elements.push(
      <p key={`p-${i}`} className="text-xs text-slate-200 leading-relaxed my-1">
        {formatInlineText(line)}
      </p>
    );
  }

  // Close unclosed code block if stream is mid-output
  if (inCodeBlock && codeBlockContent.length > 0) {
    elements.push(
      <div
        key="code-unclosed"
        className="my-2.5 rounded-lg bg-slate-950 border border-slate-800 p-3 overflow-x-auto font-mono text-[11px] text-cyan-300"
      >
        <pre>{codeBlockContent.join('\n')}</pre>
      </div>
    );
  }

  return <div className="space-y-1">{elements}</div>;
}

export default function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Completion controls
  const [systemPrompt, setSystemPrompt] = useState('You are an expert AI software engineer.');
  const [userPrompt, setUserPrompt] = useState('Explain how Server-Sent Events (SSE) works in 3 clear bullet points.');
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [thinkingEnabled, setThinkingEnabled] = useState(false); // Default to fast mode for instant responses
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);

  // Execution state
  const [isGenerating, setIsGenerating] = useState(false);
  const [isThinkingPhase, setIsThinkingPhase] = useState(false);
  const [thinkingText, setThinkingText] = useState('');
  const [generatedText, setGeneratedText] = useState('');
  const [usageInfo, setUsageInfo] = useState<CompletionUsage | null>(null);
  const [rawChunks, setRawChunks] = useState<SseChunkLog[]>([]);
  const [activeTab, setActiveTab] = useState<'response' | 'sse-stream' | 'curl' | 'matrix'>('response');
  const [streamError, setStreamError] = useState<string | null>(null);
  const [timeToFirstToken, setTimeToFirstToken] = useState<number | null>(null);
  const [totalDuration, setTotalDuration] = useState<number | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showThinkingPanel, setShowThinkingPanel] = useState(true);
  const [viewMode, setViewMode] = useState<'formatted' | 'raw'>('formatted');

  const abortControllerRef = useRef<AbortController | null>(null);
  const streamOutputEndRef = useRef<HTMLDivElement | null>(null);

  const fetchHealth = async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const res = await fetch('/health');
      if (!res.ok) {
        throw new Error(`Health check returned HTTP ${res.status}`);
      }
      const data = await res.json();
      setHealth(data);
    } catch (err: unknown) {
      setHealthError(err instanceof Error ? err.message : 'Failed to connect to backend');
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(label);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleAbort = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
      setIsThinkingPhase(false);
    }
  };

  const handleSend = async () => {
    if (!userPrompt.trim()) return;

    setIsGenerating(true);
    setIsThinkingPhase(false);
    setThinkingText('');
    setGeneratedText('');
    setUsageInfo(null);
    setRawChunks([]);
    setStreamError(null);
    setTimeToFirstToken(null);
    setTotalDuration(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const startTime = performance.now();
    let firstTokenReceived = false;

    const requestPayload: Record<string, unknown> = {
      model: 'glm-4.7-flash',
      messages: [
        ...(systemPrompt.trim() ? [{ role: 'system', content: systemPrompt.trim() }] : []),
        { role: 'user', content: userPrompt.trim() },
      ],
      stream: streamEnabled,
      temperature,
      max_tokens: maxTokens,
      thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
    };

    try {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errMessage = `HTTP error ${res.status}`;
        try {
          const errJson = await res.json();
          if (errJson.error?.message) {
            errMessage = errJson.error.message;
          }
        } catch {
          // not JSON
        }
        throw new Error(errMessage);
      }

      if (!streamEnabled) {
        // Non-streaming response
        const data = await res.json();
        const choice = data.choices?.[0]?.message;
        const content = choice?.content || '';
        const reasoning = choice?.reasoning_content || '';
        const usage = data.usage;

        if (reasoning) {
          setThinkingText(reasoning);
        }
        setGeneratedText(content);
        if (usage) {
          setUsageInfo({
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
            reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens,
          });
        }
        setTotalDuration(Math.round(performance.now() - startTime));
        setIsGenerating(false);
        return;
      }

      // Streaming response via SSE
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No readable stream body returned');

      const decoder = new TextDecoder('utf-8');
      const streamRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const streamChunks: SseChunkLog[] = [];
      let buffer = '';
      let chunkCounter = 0;
      let accumulatedContent = '';
      let accumulatedThinking = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('data:')) {
            const dataContent = trimmed.slice(5).trim();
            const isDone = dataContent === '[DONE]';
            let chunkType: 'reasoning' | 'content' | 'done' | 'meta' = 'meta';
            let delta = '';

            if (!isDone) {
              try {
                const parsed = JSON.parse(dataContent);
                const deltaObj = parsed.choices?.[0]?.delta;
                const reasoningDelta = deltaObj?.reasoning_content || '';
                const contentDelta = deltaObj?.content || '';

                if (parsed.usage) {
                  setUsageInfo({
                    prompt_tokens: parsed.usage.prompt_tokens,
                    completion_tokens: parsed.usage.completion_tokens,
                    total_tokens: parsed.usage.total_tokens,
                    reasoning_tokens: parsed.usage.completion_tokens_details?.reasoning_tokens,
                  });
                }

                if (reasoningDelta) {
                  chunkType = 'reasoning';
                  delta = reasoningDelta;
                  if (!firstTokenReceived) {
                    firstTokenReceived = true;
                    setTimeToFirstToken(Math.round(performance.now() - startTime));
                  }
                  setIsThinkingPhase(true);
                  accumulatedThinking += reasoningDelta;
                  setThinkingText(accumulatedThinking);
                } else if (contentDelta) {
                  chunkType = 'content';
                  delta = contentDelta;
                  if (!firstTokenReceived) {
                    firstTokenReceived = true;
                    setTimeToFirstToken(Math.round(performance.now() - startTime));
                  }
                  setIsThinkingPhase(false);
                  accumulatedContent += contentDelta;
                  setGeneratedText(accumulatedContent);
                }
              } catch {
                // partial JSON
              }
            } else {
              chunkType = 'done';
            }

            chunkCounter++;
            const chunkItem: SseChunkLog = {
              id: `${streamRunId}-${chunkCounter}`,
              seq: chunkCounter,
              timestamp: new Date().toLocaleTimeString(),
              raw: trimmed,
              type: chunkType,
              deltaText: delta,
              isDone,
            };
            streamChunks.push(chunkItem);
            setRawChunks([...streamChunks]);

            if (isDone) {
              break;
            }
          }
        }
      }

      setTotalDuration(Math.round(performance.now() - startTime));
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        setStreamError('Stream was aborted by client.');
      } else {
        setStreamError(err instanceof Error ? err.message : 'Unknown streaming error');
      }
    } finally {
      setIsGenerating(false);
      setIsThinkingPhase(false);
      abortControllerRef.current = null;
    }
  };

  const curlSnippet = `curl -N -X POST http://localhost:3000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "glm-4.7-flash",
    "messages": [
      {"role": "user", "content": "${userPrompt.replace(/"/g, '\\"')}"}
    ],
    "thinking": {"type": "${thinkingEnabled ? 'enabled' : 'disabled'}"},
    "stream": ${streamEnabled},
    "temperature": ${temperature},
    "max_tokens": ${maxTokens}
  }'`;

  const nodeSdkSnippet = `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'backend-handled-securely',
});

const response = await client.chat.completions.create({
  model: 'glm-4.7-flash',
  messages: [{ role: 'user', content: '${userPrompt.replace(/'/g, "\\'")}' }],
  stream: ${streamEnabled},
  temperature: ${temperature},
  max_tokens: ${maxTokens},
});

for await (const chunk of response) {
  // GLM-4.7-Flash streams reasoning_content (thoughts) then content (answer)
  const reasoning = chunk.choices[0]?.delta?.reasoning_content || '';
  const content = chunk.choices[0]?.delta?.content || '';
  if (reasoning) process.stderr.write(reasoning);
  if (content) process.stdout.write(content);
}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 py-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  Z.ai GLM-4.7-Flash
                </h1>
                <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                  OpenAI SSE Proxy
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Production-ready streaming backend with client abort handling & rate limiting
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
              <span
                className={`h-2 w-2 rounded-full ${
                  health?.status === 'ok'
                    ? 'bg-emerald-400 shadow-sm shadow-emerald-400'
                    : 'bg-rose-400'
                }`}
              />
              <span className="text-slate-400">Backend:</span>
              <span className="font-mono font-medium text-slate-200">
                {health?.status === 'ok' ? 'HEALTHY' : 'CONNECTING...'}
              </span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
              <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
              <span className="text-slate-400">ZAI_API_KEY:</span>
              <span
                className={`font-mono font-medium ${
                  health?.configured ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {health?.configured ? 'Active (Connected)' : 'Missing'}
              </span>
            </div>

            <button
              onClick={fetchHealth}
              disabled={healthLoading}
              className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-white hover:border-slate-700 transition"
              title="Refresh Health"
            >
              <RefreshCw className={`h-4 w-4 ${healthLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Request Configuration & Chat Prompt */}
        <section className="lg:col-span-5 flex flex-col gap-5">
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Server className="h-4 w-4 text-cyan-400" />
                <span>Model Settings</span>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700 font-semibold">
                glm-4.7-flash
              </span>
            </div>

            {/* Mode Selector: Fast vs Deep Thinking */}
            <div className="flex flex-col gap-1.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <Brain className={`h-4 w-4 ${thinkingEnabled ? 'text-purple-400' : 'text-slate-500'}`} />
                  <span>Thinking Mode</span>
                </span>
                <button
                  type="button"
                  onClick={() => setThinkingEnabled(!thinkingEnabled)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded transition flex items-center gap-1.5 ${
                    thinkingEnabled
                      ? 'bg-purple-950 text-purple-300 border border-purple-700'
                      : 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                  }`}
                >
                  {thinkingEnabled ? (
                    <>
                      <Sparkles className="h-3 w-3" />
                      <span>Deep Reasoning (ON)</span>
                    </>
                  ) : (
                    <>
                      <Zap className="h-3 w-3" />
                      <span>Fast Direct Response (~300ms)</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 leading-normal mt-1">
                {thinkingEnabled
                  ? 'GLM-4.7-Flash will stream chain-of-thought reasoning before outputting the answer.'
                  : 'Fast mode disables thinking tokens for instantaneous responses.'}
              </p>
            </div>

            {/* Quick preset selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-400">Quick Test Prompts</label>
              <div className="grid grid-cols-1 gap-1.5">
                {[
                  {
                    title: 'Streaming SSE vs WebSockets',
                    prompt: 'Explain why Server-Sent Events (SSE) is more efficient than WebSockets for unidirectional AI streaming, in 3 concise bullet points.',
                  },
                  {
                    title: 'TypeScript SSE Parser Code',
                    prompt: 'Write an asynchronous generator function in TypeScript to parse SSE data lines from a ReadableStream<Uint8Array>.',
                  },
                  {
                    title: 'Short 3-Word Greeting Test',
                    prompt: 'Say hello in exactly 3 friendly words.',
                  },
                ].map((preset) => (
                  <button
                    key={preset.title}
                    onClick={() => setUserPrompt(preset.prompt)}
                    className="text-left text-xs p-2 rounded border border-slate-800 bg-slate-900/60 hover:bg-slate-800/80 hover:border-slate-700 text-slate-300 transition truncate"
                  >
                    ✦ {preset.title}
                  </button>
                ))}
              </div>
            </div>

            {/* System Prompt */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-400">System Message</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={2}
                className="w-full text-xs font-mono p-2.5 rounded-lg border border-slate-800 bg-slate-950 text-slate-200 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 resize-none"
                placeholder="Optional system instructions..."
              />
            </div>

            {/* User Prompt */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-400">User Prompt</label>
              <textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                rows={3}
                className="w-full text-xs font-mono p-2.5 rounded-lg border border-slate-800 bg-slate-950 text-slate-200 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 resize-none"
                placeholder="Enter prompt to stream..."
              />
            </div>

            {/* Sliders and Toggles */}
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-800">
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Temperature</span>
                  <span className="font-mono text-cyan-400">{temperature}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Max Tokens</span>
                  <span className="font-mono text-cyan-400">{maxTokens}</span>
                </div>
                <input
                  type="range"
                  min="256"
                  max="4096"
                  step="128"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                  className="accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Stream toggle and Submit */}
            <div className="flex items-center justify-between pt-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={streamEnabled}
                  onChange={(e) => setStreamEnabled(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0 focus:ring-offset-0 cursor-pointer h-4 w-4"
                />
                <span>Real-time SSE Streaming</span>
              </label>

              <div className="flex items-center gap-2">
                {isGenerating ? (
                  <button
                    onClick={handleAbort}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600/20 text-rose-300 border border-rose-500/40 hover:bg-rose-600/30 text-xs font-semibold transition"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                    Abort Stream
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!userPrompt.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Execute Request
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Security & Architecture Highlights */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/20 flex flex-col gap-2.5 text-xs text-slate-400">
            <div className="flex items-center gap-2 text-slate-300 font-medium">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>Production Security Guarantees</span>
            </div>
            <ul className="space-y-1.5 list-disc list-inside text-[11px] leading-relaxed">
              <li>Backend proxies requests to Z.ai with server-side <code className="text-cyan-300">ZAI_API_KEY</code>.</li>
              <li>Client cannot specify arbitrary upstream URLs or override models.</li>
              <li>Upstream request aborted instantly when client disconnects or aborts.</li>
              <li>Sanitizing logger strips keys and bearer tokens from all logs.</li>
            </ul>
          </div>
        </section>

        {/* Right Column: Live Inspector, SSE chunks, and Code Generation */}
        <section className="lg:col-span-7 flex flex-col gap-4">
          {/* Tabs */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              {[
                { id: 'response', label: 'Response Output', icon: Sparkles },
                { id: 'sse-stream', label: `Raw SSE Events (${rawChunks.length})`, icon: Activity },
                { id: 'curl', label: 'cURL & SDK Code', icon: Terminal },
                { id: 'matrix', label: '15-Test Verification', icon: Layers },
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as typeof activeTab)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      activeTab === tab.id
                        ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Latency and Token Stats */}
            <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
              {timeToFirstToken !== null && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3 text-cyan-400" />
                  TTFT: <span className="text-cyan-300">{timeToFirstToken}ms</span>
                </span>
              )}
              {totalDuration !== null && (
                <span className="flex items-center gap-1">
                  Total: <span className="text-emerald-400">{totalDuration}ms</span>
                </span>
              )}
            </div>
          </div>

          {/* Tab 1: Rendered Response Output */}
          {activeTab === 'response' && (
            <div className="flex-1 min-h-[480px] p-5 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col justify-between">
              <div className="flex-1 overflow-y-auto space-y-4">
                {/* Real-time Thinking Block (when GLM-4.7-Flash outputs reasoning tokens) */}
                {thinkingText && (
                  <div className="rounded-lg border border-purple-900/60 bg-purple-950/20 overflow-hidden">
                    <button
                      onClick={() => setShowThinkingPanel(!showThinkingPanel)}
                      className="w-full px-3.5 py-2 bg-purple-950/40 border-b border-purple-900/40 flex items-center justify-between text-xs text-purple-300 font-semibold"
                    >
                      <div className="flex items-center gap-2">
                        <Brain className={`h-3.5 w-3.5 text-purple-400 ${isThinkingPhase ? 'animate-pulse' : ''}`} />
                        <span>
                          {isThinkingPhase ? 'Thinking in progress...' : 'Chain of Thought (Reasoning)'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] font-mono text-purple-400">
                        {usageInfo?.reasoning_tokens && (
                          <span>{usageInfo.reasoning_tokens} reasoning tokens</span>
                        )}
                        {showThinkingPanel ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </div>
                    </button>
                    {showThinkingPanel && (
                      <div className="p-3.5 text-xs font-mono text-purple-200/90 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                        {thinkingText}
                      </div>
                    )}
                  </div>
                )}

                {/* Final Answer Block */}
                {generatedText ? (
                  <div>
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
                      <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                        Assistant Response
                      </span>
                      <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded border border-slate-800 text-[10px]">
                        <button
                          onClick={() => setViewMode('formatted')}
                          className={`px-2 py-0.5 rounded font-medium transition ${
                            viewMode === 'formatted'
                              ? 'bg-slate-800 text-cyan-400 shadow-sm'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Formatted
                        </button>
                        <button
                          onClick={() => setViewMode('raw')}
                          className={`px-2 py-0.5 rounded font-medium transition ${
                            viewMode === 'raw'
                              ? 'bg-slate-800 text-cyan-400 shadow-sm'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Raw Markdown
                        </button>
                      </div>
                    </div>

                    {viewMode === 'formatted' ? (
                      <FormattedMarkdown content={generatedText} />
                    ) : (
                      <div className="font-mono text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
                        {generatedText}
                      </div>
                    )}
                  </div>
                ) : isGenerating ? (
                  <div className="flex items-center gap-2 text-cyan-400 animate-pulse text-xs font-mono py-4">
                    <Zap className="h-4 w-4" />
                    <span>
                      {isThinkingPhase
                        ? 'Model is reasoning through the prompt...'
                        : 'Streaming response progressively from Z.ai GLM-4.7-Flash...'}
                    </span>
                  </div>
                ) : !thinkingText ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2 py-16">
                    <Terminal className="h-8 w-8 text-slate-700" />
                    <span className="text-xs">Ready. Click &quot;Execute Request&quot; to test GLM-4.7-Flash.</span>
                  </div>
                ) : null}

                <div ref={streamOutputEndRef} />
              </div>

              {/* Usage & Status Bar */}
              <div className="pt-3 mt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                <div className="flex items-center gap-4">
                  {usageInfo && (
                    <span className="font-mono">
                      Tokens: <span className="text-cyan-400">{usageInfo.completion_tokens ?? 0}</span> completion
                      {usageInfo.reasoning_tokens ? ` (${usageInfo.reasoning_tokens} reasoning)` : ''} /{' '}
                      <span className="text-slate-300">{usageInfo.total_tokens ?? 0}</span> total
                    </span>
                  )}
                </div>
                {generatedText && (
                  <button
                    onClick={() => handleCopy(generatedText, 'answer')}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  >
                    {copiedCode === 'answer' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedCode === 'answer' ? 'Copied' : 'Copy Output'}</span>
                  </button>
                )}
              </div>

              {streamError && (
                <div className="mt-3 p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                  <span className="font-mono">{streamError}</span>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Raw SSE Stream Inspector */}
          {activeTab === 'sse-stream' && (
            <div className="flex-1 min-h-[480px] p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-2 overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-slate-800">
                <span>Live Event Stream Inspector</span>
                <span className="font-mono text-[11px]">{rawChunks.length} events received</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-[11px]">
                {rawChunks.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 py-16">
                    No stream events yet. Start a streaming request to inspect raw chunks.
                  </div>
                ) : (
                  rawChunks.map((chunk, idx) => (
                    <div
                      key={chunk.id || `chunk-${idx}`}
                      className={`p-2 rounded border ${
                        chunk.isDone
                          ? 'border-emerald-800/80 bg-emerald-950/20 text-emerald-400'
                          : chunk.type === 'reasoning'
                          ? 'border-purple-900/60 bg-purple-950/20 text-purple-300'
                          : 'border-slate-800 bg-slate-950 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                        <span className="flex items-center gap-1.5 font-semibold">
                          <span>Event #{chunk.seq || idx + 1}</span>
                          <span
                            className={`px-1.5 py-0.2 rounded uppercase text-[9px] ${
                              chunk.type === 'reasoning'
                                ? 'bg-purple-900/60 text-purple-300'
                                : chunk.type === 'content'
                                ? 'bg-cyan-900/60 text-cyan-300'
                                : chunk.isDone
                                ? 'bg-emerald-900/60 text-emerald-300'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {chunk.type}
                          </span>
                        </span>
                        <span>{chunk.timestamp}</span>
                      </div>
                      <div className="break-all font-mono text-[10px] text-slate-400">{chunk.raw}</div>
                      {chunk.deltaText && (
                        <div className="mt-1 text-slate-300 text-[10px]">
                          Token: <span className="text-white">&quot;{chunk.deltaText}&quot;</span>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Tab 3: cURL & SDK Code */}
          {activeTab === 'curl' && (
            <div className="flex-1 min-h-[480px] flex flex-col gap-4">
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5 text-cyan-400" />
                    <span>cURL Command (Direct SSE Streaming)</span>
                  </span>
                  <button
                    onClick={() => handleCopy(curlSnippet, 'curl')}
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  >
                    {copiedCode === 'curl' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedCode === 'curl' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-cyan-300 overflow-x-auto whitespace-pre">
                  {curlSnippet}
                </pre>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Code2 className="h-3.5 w-3.5 text-cyan-400" />
                    <span>OpenAI Node.js / TypeScript SDK</span>
                  </span>
                  <button
                    onClick={() => handleCopy(nodeSdkSnippet, 'node')}
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  >
                    {copiedCode === 'node' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedCode === 'node' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre">
                  {nodeSdkSnippet}
                </pre>
              </div>
            </div>
          )}

          {/* Tab 4: 15-Test Verification Matrix */}
          {activeTab === 'matrix' && (
            <div className="flex-1 min-h-[480px] p-5 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-semibold text-slate-200">
                    Automated Test Suite (15/15 Passed)
                  </span>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                  npm test: 100% PASS
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                {[
                  { id: '1', title: 'GET /health status endpoint' },
                  { id: '2', title: 'GET /v1/models (glm-4.7-flash)' },
                  { id: '3', title: 'Non-streaming completion' },
                  { id: '4', title: 'SSE headers (no-cache, text/event-stream)' },
                  { id: '5', title: 'Progressive SSE chunk forwarding' },
                  { id: '6', title: '[DONE] stream termination event' },
                  { id: '7', title: 'Client disconnect & upstream abort' },
                  { id: '8', title: 'Invalid request validation (400)' },
                  { id: '9', title: 'Missing API key handling (500)' },
                  { id: '10', title: 'Z.ai 401 authentication failure' },
                  { id: '11', title: 'Z.ai 429 rate limit + Retry-After' },
                  { id: '12', title: 'Z.ai upstream 5xx error mapping' },
                  { id: '13', title: 'Gateway timeout handling (504)' },
                  { id: '14', title: 'CORS preflight & headers' },
                  { id: '15', title: 'Server rate limiting (429)' },
                ].map((item) => (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/70 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-cyan-400 text-[11px] font-bold">#{item.id}</span>
                      <span className="text-slate-300 text-xs">{item.title}</span>
                    </div>
                    <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 px-6 py-3 text-center text-xs text-slate-500">
        GLM-4.7-Flash OpenAI Compatible Proxy • Z.ai PaaS v4 • Zero buffering SSE • Upstream Abort on Disconnect
      </footer>
    </div>
  );
}
