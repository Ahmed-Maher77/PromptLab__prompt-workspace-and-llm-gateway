import { HttpErrorResponse } from '@angular/common/http';
import { isTransientHttpError } from './http-retry.util';

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
