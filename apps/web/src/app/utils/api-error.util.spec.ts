import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { toApiErrorMessage } from './api-error.util';

function http(status: number, error: unknown = null, headers?: Record<string, string>) {
  return new HttpErrorResponse({
    status,
    error,
    headers: headers ? new HttpHeaders(headers) : undefined,
    url: '/api/things',
    statusText: 'Whatever',
  });
}

describe('toApiErrorMessage', () => {
  const fallback = 'Something failed.';

  it('prefers problem details detail over message and title', () => {
    const err = http(422, { title: 'Unprocessable', detail: 'Name is required', message: 'x' });
    expect(toApiErrorMessage(err, fallback)).toBe('Name is required');
  });

  it('uses a string message from legacy bodies', () => {
    expect(toApiErrorMessage(http(400, { message: 'Bad input' }), fallback)).toBe('Bad input');
  });

  it('uses the first item of an array message', () => {
    const err = http(400, { message: ['name must be a string', 'age must be a number'] });
    expect(toApiErrorMessage(err, fallback)).toBe('name must be a string');
  });

  it('uses the title when there is no detail or message', () => {
    expect(toApiErrorMessage(http(400, { title: 'Bad Request' }), fallback)).toBe('Bad Request');
  });

  it('skips blank values', () => {
    expect(toApiErrorMessage(http(400, { detail: '  ', title: 'Bad Request' }), fallback)).toBe(
      'Bad Request',
    );
  });

  it('never returns the generic Angular message', () => {
    const msg = toApiErrorMessage(http(400, 'plain text'), fallback);
    expect(msg).toBe(fallback);
    expect(msg).not.toContain('Http failure response');
  });

  it('maps status 0 to a connectivity message', () => {
    expect(toApiErrorMessage(http(0), fallback)).toBe(
      'Cannot reach the server. Check your connection.',
    );
  });

  it('maps 401 and 403', () => {
    expect(toApiErrorMessage(http(401), fallback)).toContain('sign in');
    expect(toApiErrorMessage(http(403), fallback)).toContain('permission');
  });

  it('maps 404 and 409', () => {
    expect(toApiErrorMessage(http(404), fallback)).toContain('not found');
    expect(toApiErrorMessage(http(409), fallback)).toContain('conflicts');
  });

  it('maps 429 using Retry-After seconds when present', () => {
    expect(toApiErrorMessage(http(429, null, { 'Retry-After': '12' }), fallback)).toBe(
      'Too many requests. Try again in 12 seconds.',
    );
    expect(toApiErrorMessage(http(429, null, { 'Retry-After': '1' }), fallback)).toBe(
      'Too many requests. Try again in 1 second.',
    );
  });

  it('maps 429 without a usable Retry-After', () => {
    expect(toApiErrorMessage(http(429), fallback)).toMatch(/^Too many requests/);
    expect(toApiErrorMessage(http(429, null, { 'Retry-After': 'soon' }), fallback)).not.toContain(
      'Try again in',
    );
  });

  it('maps 5xx to a server problem message', () => {
    expect(toApiErrorMessage(http(500), fallback)).toBe(
      'The server had a problem. Please try again shortly.',
    );
    expect(toApiErrorMessage(http(503), fallback)).toContain('server had a problem');
  });

  it('falls back for other statuses without a body', () => {
    expect(toApiErrorMessage(http(418), fallback)).toBe(fallback);
  });

  it('falls back for non-HTTP errors', () => {
    expect(toApiErrorMessage(new Error('boom'), fallback)).toBe(fallback);
    expect(toApiErrorMessage('oops', fallback)).toBe(fallback);
    expect(toApiErrorMessage(null, fallback)).toBe(fallback);
    expect(toApiErrorMessage(undefined, fallback)).toBe(fallback);
  });

  it('accepts HTTP-error-shaped plain objects', () => {
    expect(toApiErrorMessage({ status: 400, error: { detail: 'Nope' } }, fallback)).toBe('Nope');
  });
});
