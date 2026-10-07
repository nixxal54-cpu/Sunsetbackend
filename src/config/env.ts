import dotenv from 'dotenv';
import { DEFAULT_ZAI_BASE_URL } from '../types/zai.js';

dotenv.config();

export interface ServerConfig {
  zaiApiKey: string;
  zaiBaseUrl: string;
  port: number;
  allowedOrigins: string[];
  rateLimitMax: number;
  rateLimitWindowMs: number;
  upstreamTimeoutMs: number;
  isProduction: boolean;
}

function parseOrigins(value: string | undefined): string[] {
  if (!value || value.trim() === '*' || value.trim() === '') {
    return ['*'];
  }
  return value
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export function loadConfig(): ServerConfig {
  const zaiApiKey = (process.env.ZAI_API_KEY || '').trim();
  let zaiBaseUrl = (process.env.ZAI_BASE_URL || DEFAULT_ZAI_BASE_URL).trim();
  // Strip trailing slashes
  zaiBaseUrl = zaiBaseUrl.replace(/\/+$/, '');

  const port = parseInt(process.env.PORT || '3000', 10) || 3000;
  const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX || '60', 10) || 60;
  const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10) || 60000;
  const upstreamTimeoutMs = parseInt(process.env.UPSTREAM_TIMEOUT || '120000', 10) || 120000;

  return {
    zaiApiKey,
    zaiBaseUrl,
    port,
    allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
    rateLimitMax,
    rateLimitWindowMs,
    upstreamTimeoutMs,
    isProduction: process.env.NODE_ENV === 'production',
  };
}

export const config = loadConfig();
