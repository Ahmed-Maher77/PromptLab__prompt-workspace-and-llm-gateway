import { HttpErrorResponse } from '@angular/common/http';

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

interface HttpErrorLike {
  status?: number;
  error?: unknown;
  headers?: { get?(name: string): string | null };
}

function isHttpErrorLike(err: unknown): err is HttpErrorLike {
  return (
    err instanceof HttpErrorResponse ||
    (!!err && typeof err === 'object' && !(err instanceof Error) && ('error' in err || 'status' in err))
  );
}

function retryAfterSeconds(err: HttpErrorLike): number | null {
  const raw = err.headers?.get?.('Retry-After');
  if (!raw) {
    return null;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

function statusMessage(err: HttpErrorLike): string | null {
  const status = err.status;
  if (typeof status !== 'number') {
    return null;
  }
  if (status === 0) {
    return 'Cannot reach the server. Check your connection.';
  }
  if (status === 401) {
    return 'Your session has expired. Please sign in again.';
  }
  if (status === 403) {
    return 'You do not have permission to do that.';
  }
  if (status === 404) {
    return 'The requested resource was not found.';
  }
  if (status === 409) {
    return 'This conflicts with the current state. Refresh and try again.';
  }
  if (status === 429) {
    const seconds = retryAfterSeconds(err);
    return seconds
      ? `Too many requests. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`
      : 'Too many requests. Please wait a moment and try again.';
  }
  if (status >= 500) {
    return 'The server had a problem. Please try again shortly.';
  }
  return null;
}

/**
 * Turns any thrown value into a message that is safe to show to a user. Prefers the
 * server's RFC 9457 problem details (`detail`, then `title`), falls back to legacy
 * `{ message }` bodies, then to a status-based message. Never returns the generic
 * "Http failure response for ..." text.
 */
export function toApiErrorMessage(err: unknown, fallback: string): string {
  if (!isHttpErrorLike(err)) {
    return fallback;
  }

  const body: unknown = err.error;
  if (body && typeof body === 'object') {
    const problem = body as Record<string, unknown>;
    const detail = nonEmpty(problem['detail']);
    if (detail) {
      return detail;
    }
    const message = problem['message'];
    const text = Array.isArray(message) ? nonEmpty(message[0]) : nonEmpty(message);
    if (text) {
      return text;
    }
    const title = nonEmpty(problem['title']);
    if (title) {
      return title;
    }
  }

  return statusMessage(err) ?? fallback;
}
