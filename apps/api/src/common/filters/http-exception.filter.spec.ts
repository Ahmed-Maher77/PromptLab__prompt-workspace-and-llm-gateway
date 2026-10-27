import { ArgumentsHost, HttpException, HttpStatus, ConflictException } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';
import { Prisma } from '@prisma/client';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockResponse: {
    status: jest.Mock;
    json: jest.Mock;
    setHeader: jest.Mock;
    getHeader: jest.Mock;
  };
  let mockRequest: {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  let mockHost: ArgumentsHost;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      getHeader: jest.fn(),
    };
    mockRequest = {
      method: 'POST',
      url: '/api/conversations',
      headers: {},
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as unknown as ArgumentsHost;

    // Spy on logger
    loggerWarnSpy = jest.spyOn((filter as unknown as { logger: { warn: jest.Mock } }).logger, 'warn').mockImplementation(() => {});
    loggerErrorSpy = jest.spyOn((filter as unknown as { logger: { error: jest.Mock } }).logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('handles standard HttpException with string response and RFC 9457 structure', () => {
    const exception = new HttpException('Forbidden resource', HttpStatus.FORBIDDEN);

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.status).toBe(HttpStatus.FORBIDDEN);
    expect(body.statusCode).toBe(HttpStatus.FORBIDDEN);
    expect(body.title).toBe('Forbidden');
    expect(body.detail).toBe('Forbidden resource');
    expect(body.instance).toBe('/api/conversations');
    expect(body.path).toBe('/api/conversations');
    expect(body.message).toBe('Forbidden resource');
    expect(body.requestId).toBeDefined();
    expect(mockResponse.setHeader).toHaveBeenCalledWith('x-request-id', body.requestId);
    expect(loggerWarnSpy).toHaveBeenCalled();
  });

  it('handles HttpException with object response containing an array of validation errors', () => {
    const validationErrors = ['title must not be empty', 'provider must be valid'];
    const exception = new HttpException(
      { message: validationErrors, error: 'Bad Request', statusCode: 400 },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(body.message).toBe('title must not be empty; provider must be valid');
    expect(body.detail).toBe('title must not be empty; provider must be valid');
    expect(body.code).toBe('Bad Request');
    expect(loggerWarnSpy).toHaveBeenCalled();
  });

  it('handles generic unhandled Error by obscuring internal message with safe 500 error', () => {
    const error = new Error('Database connection failed password=secret');

    filter.catch(error, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.message).toBe('An unexpected error occurred');
    expect(body.title).toBe('Internal Server Error');
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it('handles unknown non-Error thrown objects safely', () => {
    filter.catch('unknown string exception', mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.message).toBe('Internal server error');
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  describe('RFC 9457 structured 429 exceptions with Retry-After', () => {
    it('sets Retry-After header and passes through code and retryAfterSeconds on 429 quota exception', () => {
      const quotaException = new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'QUOTA_EXCEEDED',
          message: 'Monthly token quota exceeded.',
          tokenLimit: 100000,
          remainingTokens: 0,
          retryAfterSeconds: 3600,
          resetDate: '2026-11-01T00:00:00.000Z',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );

      filter.catch(quotaException, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Retry-After', '3600');

      const body = mockResponse.json.mock.calls[0][0];
      expect(body.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(body.code).toBe('QUOTA_EXCEEDED');
      expect(body.retryAfterSeconds).toBe(3600);
      expect(body.tokenLimit).toBe(100000);
      expect(body.remainingTokens).toBe(0);
      expect(body.resetDate).toBe('2026-11-01T00:00:00.000Z');
      expect(body.title).toBe('Too Many Requests');
      expect(loggerWarnSpy).toHaveBeenCalled();
    });

    it('defaults retryAfterSeconds to 60 if not specified on 429 exception', () => {
      const generic429 = new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);

      filter.catch(generic429, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Retry-After', '60');

      const body = mockResponse.json.mock.calls[0][0];
      expect(body.retryAfterSeconds).toBe(60);
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('Prisma known request error mapping', () => {
    it('maps P2002 to 409 Conflict', () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.4.1',
      });

      filter.catch(prismaError, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.status).toBe(HttpStatus.CONFLICT);
      expect(body.statusCode).toBe(HttpStatus.CONFLICT);
      expect(body.code).toBe('P2002');
      expect(body.title).toBe('Conflict');
      expect(body.detail).toContain('unique constraint');
      expect(loggerWarnSpy).toHaveBeenCalled();
    });

    it('maps P2025 to 404 Not Found', () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError('Record to update not found', {
        code: 'P2025',
        clientVersion: '6.4.1',
      });

      filter.catch(prismaError, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.status).toBe(HttpStatus.NOT_FOUND);
      expect(body.statusCode).toBe(HttpStatus.NOT_FOUND);
      expect(body.code).toBe('P2025');
      expect(body.title).toBe('Not Found');
      expect(body.detail).toContain('not found');
      expect(loggerWarnSpy).toHaveBeenCalled();
    });

    it('maps P2003 to 422 Unprocessable Entity', () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
        code: 'P2003',
        clientVersion: '6.4.1',
      });

      filter.catch(prismaError, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(body.statusCode).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(body.code).toBe('P2003');
      expect(body.title).toBe('Unprocessable Entity');
      expect(body.detail).toContain('Foreign key constraint');
      expect(loggerWarnSpy).toHaveBeenCalled();
    });

    it('maps unhandled Prisma codes (e.g. P2010) to 500 Internal Server Error', () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError('Raw query failed', {
        code: 'P2010',
        clientVersion: '6.4.1',
      });

      filter.catch(prismaError, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.code).toBe('P2010');
      expect(loggerErrorSpy).toHaveBeenCalled();
    });

    it('maps PrismaClientValidationError to 400 Bad Request', () => {
      const validationError = new Prisma.PrismaClientValidationError(
        'Invalid `prisma.user.create()` invocation: missing required argument email.',
        { clientVersion: '6.4.1' },
      );

      filter.catch(validationError, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.status).toBe(HttpStatus.BAD_REQUEST);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.title).toBe('Bad Request');
      expect(loggerWarnSpy).toHaveBeenCalled();
    });
  });

  describe('RFC 9457 Content-Type and Throttler Retry-After preservation', () => {
    it('sets Content-Type to application/problem+json on every error response', () => {
      const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
      filter.catch(exception, mockHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/problem+json');
    });

    it('preserves existing Retry-After header already set by Throttler guard', () => {
      mockResponse.getHeader.mockReturnValueOnce('15');

      const throttlerException = new HttpException(
        'ThrottlerException: Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );

      filter.catch(throttlerException, mockHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Retry-After', '15');
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.retryAfterSeconds).toBe(15);
    });
  });

  describe('Request ID handling', () => {
    it('reuses req.id set by RequestIdMiddleware', () => {
      (mockRequest as any).id = 'req-from-middleware-123';

      const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
      filter.catch(exception, mockHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('x-request-id', 'req-from-middleware-123');
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.requestId).toBe('req-from-middleware-123');
    });

    it('propagates incoming x-request-id header when provided', () => {
      mockRequest.headers['x-request-id'] = 'custom-req-id-12345';

      const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
      filter.catch(exception, mockHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('x-request-id', 'custom-req-id-12345');
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.requestId).toBe('custom-req-id-12345');
    });

    it('generates a new UUID when x-request-id is absent', () => {
      const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(body.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith('x-request-id', body.requestId);
    });
  });

  describe('Machine-readable error codes', () => {
    it('uses UPPER_SNAKE message as code when Nest standard object has error: "Conflict" but message: "REQUEST_IN_PROGRESS"', () => {
      const exception = new ConflictException('REQUEST_IN_PROGRESS');
      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.status).toBe(HttpStatus.CONFLICT);
      expect(body.message).toBe('REQUEST_IN_PROGRESS');
      expect(body.code).toBe('REQUEST_IN_PROGRESS');
    });

    it('uses UPPER_SNAKE message as code for raw string HttpException', () => {
      const exception = new HttpException('IDEMPOTENCY_RESULT_UNAVAILABLE', HttpStatus.CONFLICT);
      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.status).toBe(HttpStatus.CONFLICT);
      expect(body.message).toBe('IDEMPOTENCY_RESULT_UNAVAILABLE');
      expect(body.code).toBe('IDEMPOTENCY_RESULT_UNAVAILABLE');
    });

    it('preserves explicit code from object response', () => {
      const exception = new ConflictException({
        message: 'Key already used',
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.status).toBe(HttpStatus.CONFLICT);
      expect(body.message).toBe('Key already used');
      expect(body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('falls back to generic error string when message is a human sentence', () => {
      const exception = new ConflictException('A duplicate resource already exists in database');
      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.code).toBe('Conflict');
      expect(body.message).toBe('A duplicate resource already exists in database');
    });
  });

  describe('RFC 9457 reserved members', () => {
    it('keeps numeric status and core members when the exception body carries its own status/type/title', () => {
      // Shape thrown by @nestjs/terminus when a readiness check fails.
      const exception = new HttpException(
        {
          status: 'error',
          type: 'not-a-uri',
          title: 'overridden',
          info: { database: { status: 'up' } },
          error: { gateway: { status: 'down' } },
          details: { database: { status: 'up' }, gateway: { status: 'down' } },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );

      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body.type).toBe('not-a-uri'); // `type` is deliberately honoured when it is a string (existing contract)
      expect(body.title).toBe('Service Unavailable');
      expect(body.instance).toBe('/api/conversations');
      // Extension members survive.
      expect(body.info).toEqual({ database: { status: 'up' } });
      expect(body.error).toEqual({ gateway: { status: 'down' } });
      expect(body.details.gateway.status).toBe('down');
    });
  });
});
