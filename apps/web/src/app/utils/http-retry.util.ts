import { HttpErrorResponse } from '@angular/common/http';
import { Observable, retry, timer, throwError } from 'rxjs';

/**
 * Identifies transient errors eligible for retry:
 * - Network errors (status === 0)
 * - 502 Bad Gateway
 * - 503 Service Unavailable
 * - 504 Gateway Timeout
 */
export function isTransientHttpError(error: unknown): boolean {
  if (error instanceof HttpErrorResponse || (error && typeof (error as { status?: unknown }).status === 'number')) {
    const status = (error as { status: number }).status;
    return status === 0 || status === 502 || status === 503 || status === 504;
  }
  return false;
}

/**
 * Identifies errors with unknown outcomes where an idempotency key should be preserved:
 * - Network errors (status === 0)
 * - 502 Bad Gateway
 * - 503 Service Unavailable
 * - 504 Gateway Timeout
 * - 409 Conflict with code === 'REQUEST_IN_PROGRESS'
 *
 * For all other errors (including 409 IDEMPOTENCY_RESULT_UNAVAILABLE, IDEMPOTENCY_KEY_REUSED, 400 validation, etc.),
 * the outcome is known/definitive and the client must rotate its idempotency key.
 */
export function isUnknownOutcomeError(error: unknown): boolean {
  if (error instanceof HttpErrorResponse || (error && typeof (error as { status?: unknown }).status === 'number')) {
    const httpErr = error as { status: number; error?: unknown };
    const status = httpErr.status;
    if (status === 0 || status === 502 || status === 503 || status === 504) {
      return true;
    }
    if (status === 409) {
      const body = httpErr.error;
      if (typeof body === 'object' && body !== null) {
        const payload = body as { code?: string; message?: string; detail?: string };
        return (
          payload.code === 'REQUEST_IN_PROGRESS' ||
          payload.message === 'REQUEST_IN_PROGRESS' ||
          payload.detail === 'REQUEST_IN_PROGRESS'
        );
      }
      if (typeof body === 'string') {
        try {
          const parsed = JSON.parse(body) as { code?: string; message?: string; detail?: string };
          return (
            parsed.code === 'REQUEST_IN_PROGRESS' ||
            parsed.message === 'REQUEST_IN_PROGRESS' ||
            parsed.detail === 'REQUEST_IN_PROGRESS'
          );
        } catch {
          return body.includes('REQUEST_IN_PROGRESS');
        }
      }
    }
  }
  return false;
}

/**
 * RxJS operator to retry requests on transient network or 502/503/504 errors only.
 * Retries up to `count` times with exponential backoff while preserving the same Idempotency-Key.
 */
export function retryTransientErrors<T>(count = 2, baseDelayMs = 500) {
  return (source: Observable<T>): Observable<T> =>
    source.pipe(
      retry({
        count,
        delay: (error: unknown, retryIndex: number) => {
          if (isTransientHttpError(error)) {
            return timer(baseDelayMs * Math.pow(2, retryIndex - 1));
          }
          return throwError(() => error);
        },
      }),
    );
}
