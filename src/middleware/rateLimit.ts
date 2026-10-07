import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env.js';
import { OpenAIErrorResponse } from '../types/openai.js';

interface RateRecord {
  count: number;
  resetAt: number;
}

const ipRecords = new Map<string, RateRecord>();

export function resetRateLimits(): void {
  ipRecords.clear();
}

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Extract client IP address (taking X-Forwarded-For into account safely)
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string'
    ? forwarded.split(',')[0].trim()
    : req.socket.remoteAddress || '127.0.0.1';

  const now = Date.now();
  const record = ipRecords.get(ip);

  if (!record || now > record.resetAt) {
    ipRecords.set(ip, {
      count: 1,
      resetAt: now + config.rateLimitWindowMs,
    });
    next();
    return;
  }

  if (record.count >= config.rateLimitMax) {
    const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));

    const errorPayload: OpenAIErrorResponse = {
      error: {
        message: `Rate limit exceeded. Limit is ${config.rateLimitMax} requests per ${Math.round(
          config.rateLimitWindowMs / 1000
        )}s. Please try again after ${retryAfterSeconds} seconds.`,
        type: 'rate_limit_error',
        param: null,
        code: 'rate_limit_exceeded',
      },
    };

    res.status(429).json(errorPayload);
    return;
  }

  record.count += 1;
  next();
}
