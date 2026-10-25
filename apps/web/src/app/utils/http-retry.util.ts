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
