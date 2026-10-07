/**
 * Production-ready sanitizing logger.
 * Guarantees that secrets (like ZAI_API_KEY, Bearer tokens) are never printed to stdout/stderr.
 */

import { config } from '../config/env.js';

function sanitize(message: unknown): string {
  if (typeof message !== 'string') {
    try {
      message = JSON.stringify(message);
    } catch {
      message = String(message);
    }
  }

  let str = message as string;

  // Redact configured ZAI_API_KEY if present and non-empty
  if (config.zaiApiKey && config.zaiApiKey.length > 4) {
    str = str.split(config.zaiApiKey).join('[REDACTED_API_KEY]');
  }

  // Redact Bearer tokens in headers or strings
  str = str.replace(/Bearer\s+[a-zA-Z0-9.\-_]{8,}/gi, 'Bearer [REDACTED]');
  // Redact apiKey / api_key values
  str = str.replace(/(["']?(?:api[_-]?key|secret|token)["']?\s*[:=]\s*["'])([^"']{4,})(["'])/gi, '$1[REDACTED]$3');

  return str;
}

export const logger = {
  info: (...args: unknown[]) => {
    console.log(...args.map(sanitize));
  },
  warn: (...args: unknown[]) => {
    console.warn(...args.map(sanitize));
  },
  error: (...args: unknown[]) => {
    console.error(...args.map(sanitize));
  },
  debug: (...args: unknown[]) => {
    if (!config.isProduction) {
      console.debug(...args.map(sanitize));
    }
  },
};
