/**
 * API errors. Every non-2xx JSON response is `{ error: { code, message, details? } }` (ApiErrorBody);
 * clients switch on `code`, `message` is English for developers and logs.
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody, ErrorCode } from '../shared/types';

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown, headers?: Record<string, string>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export function errorBody(code: ErrorCode, message: string, details?: unknown): ApiErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export const notFound = (message = 'Not found'): HttpError => new HttpError(404, 'NOT_FOUND', message);

export function tooManyRequests(retryAfterMs: number, message = 'Too many requests, slow down'): HttpError {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return new HttpError(429, 'RATE_LIMITED', message, { retryAfterSeconds: seconds }, { 'Retry-After': String(seconds) });
}

/** Final handler for /api paths no route matched. */
export const apiNotFound: RequestHandler = (req, res) => {
  res.status(404).json(errorBody('NOT_FOUND', `No such endpoint: ${req.method} ${req.baseUrl}${req.path}`));
};

type ErrorLog = (message: string, error: unknown) => void;

/**
 * Turns anything thrown by a route into an ApiErrorBody. Unexpected errors become 500 INTERNAL:
 * the stack is logged, never sent.
 */
export function errorHandler(log: ErrorLog = (message, error) => console.error(message, error)): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof HttpError) {
      for (const [name, value] of Object.entries(err.headers ?? {})) res.setHeader(name, value);
      res.status(err.status).json(errorBody(err.code, err.message, err.details));
      return;
    }
    const { type, status } = (err ?? {}) as { type?: unknown; status?: unknown };
    if (type === 'entity.parse.failed') {
      res.status(400).json(errorBody('VALIDATION', 'The request body is not valid JSON'));
      return;
    }
    if (type === 'entity.too.large') {
      res.status(413).json(errorBody('VALIDATION', 'The request body is too large'));
      return;
    }
    if (typeof status === 'number' && status >= 400 && status < 500) {
      // Other client errors raised by Express or body-parser (unsupported charset, missing file, …).
      const message = err instanceof Error ? err.message : 'Bad request';
      res.status(status).json(errorBody(status === 404 ? 'NOT_FOUND' : 'VALIDATION', message));
      return;
    }
    log(`Unhandled error on ${req.method} ${req.originalUrl.split('?')[0]}:`, err);
    res.status(500).json(errorBody('INTERNAL', 'Internal server error'));
  };
}
