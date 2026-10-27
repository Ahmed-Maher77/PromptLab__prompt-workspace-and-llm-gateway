import { HttpErrorResponse } from '@angular/common/http';
import { isTransientHttpError, isUnknownOutcomeError } from './http-retry.util';

describe('isTransientHttpError', () => {
  it('identifies network errors (status 0) as transient', () => {
    const error = new HttpErrorResponse({ status: 0 });
    expect(isTransientHttpError(error)).toBeTrue();
  });

  it('identifies 502, 503, 504 as transient', () => {
    expect(isTransientHttpError(new HttpErrorResponse({ status: 502 }))).toBeTrue();
    expect(isTransientHttpError(new HttpErrorResponse({ status: 503 }))).toBeTrue();
    expect(isTransientHttpError(new HttpErrorResponse({ status: 504 }))).toBeTrue();
  });

  it('identifies 400, 401, 403, 404, 409, 429, 500 as non-transient', () => {
    expect(isTransientHttpError(new HttpErrorResponse({ status: 400 }))).toBeFalse();
    expect(isTransientHttpError(new HttpErrorResponse({ status: 401 }))).toBeFalse();
    expect(isTransientHttpError(new HttpErrorResponse({ status: 403 }))).toBeFalse();
    expect(isTransientHttpError(new HttpErrorResponse({ status: 404 }))).toBeFalse();
    expect(isTransientHttpError(new HttpErrorResponse({ status: 409 }))).toBeFalse();
    expect(isTransientHttpError(new HttpErrorResponse({ status: 429 }))).toBeFalse();
    expect(isTransientHttpError(new HttpErrorResponse({ status: 500 }))).toBeFalse();
  });

  it('handles non-HttpErrorResponse gracefully', () => {
    expect(isTransientHttpError(null)).toBeFalse();
    expect(isTransientHttpError(undefined)).toBeFalse();
    expect(isTransientHttpError(new Error('Standard Error'))).toBeFalse();
    expect(isTransientHttpError({ status: 503 })).toBeTrue();
  });
});

describe('isUnknownOutcomeError', () => {
  it('returns true for network errors (status 0)', () => {
    expect(isUnknownOutcomeError(new HttpErrorResponse({ status: 0 }))).toBeTrue();
  });

  it('returns true for 502, 503, 504 status codes', () => {
    expect(isUnknownOutcomeError(new HttpErrorResponse({ status: 502 }))).toBeTrue();
    expect(isUnknownOutcomeError(new HttpErrorResponse({ status: 503 }))).toBeTrue();
    expect(isUnknownOutcomeError(new HttpErrorResponse({ status: 504 }))).toBeTrue();
  });

  it('returns true for 409 Conflict with REQUEST_IN_PROGRESS (both real filter shape and explicit code shape)', () => {
    // 1. Real problem-details shape where code is 'Conflict' and message is 'REQUEST_IN_PROGRESS'
    expect(
      isUnknownOutcomeError(
        new HttpErrorResponse({
          status: 409,
          error: {
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            detail: 'REQUEST_IN_PROGRESS',
            code: 'Conflict',
            message: 'REQUEST_IN_PROGRESS',
          },
        }),
      ),
    ).toBeTrue();

    // 2. Explicit code shape where code is 'REQUEST_IN_PROGRESS'
    expect(
      isUnknownOutcomeError(
        new HttpErrorResponse({
          status: 409,
          error: {
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            code: 'REQUEST_IN_PROGRESS',
            message: 'REQUEST_IN_PROGRESS',
          },
        }),
      ),
    ).toBeTrue();

    // 3. Stringified problem-details JSON
    expect(
      isUnknownOutcomeError(
        new HttpErrorResponse({
          status: 409,
          error: JSON.stringify({
            code: 'Conflict',
            message: 'REQUEST_IN_PROGRESS',
          }),
        }),
      ),
    ).toBeTrue();
  });

  it('returns false for 409 definitive errors (e.g. IDEMPOTENCY_RESULT_UNAVAILABLE, IDEMPOTENCY_KEY_REUSED)', () => {
    expect(
      isUnknownOutcomeError(
        new HttpErrorResponse({
          status: 409,
          error: { code: 'IDEMPOTENCY_RESULT_UNAVAILABLE', message: 'Result unavailable' },
        }),
      ),
    ).toBeFalse();

    expect(
      isUnknownOutcomeError(
        new HttpErrorResponse({
          status: 409,
          error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'Key reused with different payload' },
        }),
      ),
    ).toBeFalse();

    expect(
      isUnknownOutcomeError(
        new HttpErrorResponse({
          status: 409,
          error: { code: 'CONTEXT_BUDGET_EXCEEDED', message: 'Context budget exceeded' },
        }),
      ),
    ).toBeFalse();
  });

  it('returns false for other status codes (400, 401, 403, 404, 422, 500)', () => {
    expect(isUnknownOutcomeError(new HttpErrorResponse({ status: 400 }))).toBeFalse();
    expect(isUnknownOutcomeError(new HttpErrorResponse({ status: 401 }))).toBeFalse();
    expect(isUnknownOutcomeError(new HttpErrorResponse({ status: 403 }))).toBeFalse();
    expect(isUnknownOutcomeError(new HttpErrorResponse({ status: 404 }))).toBeFalse();
    expect(isUnknownOutcomeError(new HttpErrorResponse({ status: 422 }))).toBeFalse();
    expect(isUnknownOutcomeError(new HttpErrorResponse({ status: 500 }))).toBeFalse();
  });

  it('handles null, undefined, and non-http errors safely', () => {
    expect(isUnknownOutcomeError(null)).toBeFalse();
    expect(isUnknownOutcomeError(undefined)).toBeFalse();
    expect(isUnknownOutcomeError(new Error('Unknown'))).toBeFalse();
  });
});

