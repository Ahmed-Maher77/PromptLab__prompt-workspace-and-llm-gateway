import { requestIdHandler } from './request-id.middleware';
import { Request, Response, NextFunction } from 'express';

describe('requestIdHandler', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: NextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      setHeader: jest.fn(),
    };
    nextFn = jest.fn();
  });

  it('accepts valid incoming x-request-id conforming to ^[A-Za-z0-9._-]{1,128}$', () => {
    const validId = 'req-123.abc_XYZ';
    mockReq.headers = { 'x-request-id': validId };

    requestIdHandler(mockReq as Request, mockRes as Response, nextFn);

    expect(mockReq.id).toBe(validId);
    expect(mockRes.setHeader).toHaveBeenCalledWith('x-request-id', validId);
    expect(nextFn).toHaveBeenCalled();
  });

  it('generates a new UUID when x-request-id contains invalid characters', () => {
    mockReq.headers = { 'x-request-id': '<script>alert(1)</script>' };

    requestIdHandler(mockReq as Request, mockRes as Response, nextFn);

    expect(mockReq.id).not.toBe('<script>alert(1)</script>');
    expect(mockReq.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith('x-request-id', mockReq.id);
    expect(nextFn).toHaveBeenCalled();
  });

  it('generates a new UUID when x-request-id exceeds 128 characters', () => {
    const excessivelyLongId = 'a'.repeat(129);
    mockReq.headers = { 'x-request-id': excessivelyLongId };

    requestIdHandler(mockReq as Request, mockRes as Response, nextFn);

    expect(mockReq.id).not.toBe(excessivelyLongId);
    expect(mockReq.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith('x-request-id', mockReq.id);
    expect(nextFn).toHaveBeenCalled();
  });

  it('generates a new UUID when x-request-id is missing or whitespace', () => {
    mockReq.headers = {};

    requestIdHandler(mockReq as Request, mockRes as Response, nextFn);

    expect(mockReq.id).toBeDefined();
    expect(mockReq.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith('x-request-id', mockReq.id);
    expect(nextFn).toHaveBeenCalled();
  });
});
