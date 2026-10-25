import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';

function getStatusTitle(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'Bad Request';
    case HttpStatus.UNAUTHORIZED:
      return 'Unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'Forbidden';
    case HttpStatus.NOT_FOUND:
      return 'Not Found';
    case HttpStatus.CONFLICT:
      return 'Conflict';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'Unprocessable Entity';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'Too Many Requests';
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return 'Payload Too Large';
    case HttpStatus.INTERNAL_SERVER_ERROR:
      return 'Internal Server Error';
    default:
      return status >= 500 ? 'Internal Server Error' : 'Error';
  }
}

/**
 * ERR-01: Centralized exception filter standardized on RFC 9457 Problem Details.
 *
 * Guarantees:
 *  - Preserves structured exception data (code, retryAfterSeconds, resetDate, remainingTokens, etc.)
 *  - Maps Prisma error codes: P2002 -> 409 Conflict, P2025 -> 404 Not Found, P2003 -> 422 Unprocessable Entity
 *  - Sets Retry-After header for 429 Too Many Requests responses
 *  - Generates or propagates x-request-id header on responses and log entries
 *  - Logs 4xx errors as warnings and 5xx errors as errors
 *  - Preserves legacy fields (statusCode, message, path, timestamp) for backwards compatibility
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Generate or propagate x-request-id
    const incomingRequestId = request?.headers?.['x-request-id'];
    const requestId =
      typeof incomingRequestId === 'string' && incomingRequestId.trim()
        ? incomingRequestId
        : crypto.randomUUID();

    if (typeof response?.setHeader === 'function') {
      response.setHeader('x-request-id', requestId);
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code: string | undefined;
    let title: string | undefined;
    let restExtensions: Record<string, unknown> = {};

    // 1. Prisma Known Request Errors mapping
    const isPrismaError =
      exception instanceof Prisma.PrismaClientKnownRequestError ||
      (exception !== null &&
        typeof exception === 'object' &&
        'code' in exception &&
        typeof (exception as { code: unknown }).code === 'string' &&
        (exception as { code: string }).code.startsWith('P'));

    if (isPrismaError) {
      const prismaCode = (exception as { code: string }).code;
      code = prismaCode;

      switch (prismaCode) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          title = 'Conflict';
          message =
            'A unique constraint violation occurred: a resource with these identifiers already exists.';
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          title = 'Not Found';
          message = 'The requested resource was not found.';
          break;
        case 'P2003':
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          title = 'Unprocessable Entity';
          message =
            'Foreign key constraint failed: referenced entity does not exist.';
          break;
        default:
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          title = 'Internal Server Error';
          message = 'An unexpected database error occurred';
          break;
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        exceptionResponse &&
        typeof exceptionResponse === 'object' &&
        !Array.isArray(exceptionResponse)
      ) {
        const respObj = exceptionResponse as Record<string, unknown>;
        const { message: rawMsg, statusCode: _sc, ...extra } = respObj;
        restExtensions = extra;

        if (rawMsg) {
          message = Array.isArray(rawMsg) ? rawMsg.join('; ') : String(rawMsg);
        } else if (typeof extra.error === 'string') {
          message = extra.error;
        }

        if (typeof extra.code === 'string') {
          code = extra.code;
        } else if (typeof extra.error === 'string') {
          code = extra.error;
        }
      }
    } else if (exception instanceof Error) {
      const errWithStatus = exception as Error & { status?: number; statusCode?: number; type?: string };
      if (typeof errWithStatus.status === 'number' && errWithStatus.status >= 400 && errWithStatus.status < 600) {
        status = errWithStatus.status;
      } else if (typeof errWithStatus.statusCode === 'number' && errWithStatus.statusCode >= 400 && errWithStatus.statusCode < 600) {
        status = errWithStatus.statusCode;
      }
      if (errWithStatus.type === 'entity.too.large') {
        code = 'PAYLOAD_TOO_LARGE';
      }
      message =
        status === HttpStatus.INTERNAL_SERVER_ERROR
          ? 'An unexpected error occurred'
          : exception.message;
    }

    if (!title) {
      title = getStatusTitle(status);
    }

    if (!code) {
      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        code = 'RATE_LIMIT_EXCEEDED';
      } else if (
        typeof restExtensions.error === 'string' &&
        restExtensions.error
      ) {
        code = restExtensions.error;
      }
    }

    // Handle 429 Too Many Requests -> set Retry-After header and body field
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      const retryAfterSeconds =
        typeof restExtensions.retryAfterSeconds === 'number'
          ? restExtensions.retryAfterSeconds
          : 60;

      if (typeof response?.setHeader === 'function') {
        response.setHeader('Retry-After', String(retryAfterSeconds));
      }
      restExtensions.retryAfterSeconds = retryAfterSeconds;
    }

    // Structured logging: 4xx as warn, 5xx as error
    const reqMethod = request?.method ?? 'UNKNOWN';
    const reqUrl = request?.url ?? 'UNKNOWN';
    const logPrefix = `[${requestId}] [${reqMethod}] ${reqUrl} - Status: ${status}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${logPrefix} - Error: ${exception instanceof Error ? exception.message : 'Unknown'}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${logPrefix} - Warning: ${message}`);
    }

    // RFC 9457 Problem Details format + legacy compatibility fields
    const typeUri =
      (typeof restExtensions.type === 'string' && restExtensions.type) ||
      'about:blank';

    response.status(status).json({
      type: typeUri,
      title,
      status,
      detail: message,
      instance: reqUrl,
      ...(code ? { code } : {}),
      ...restExtensions,
      // Backward-compatibility properties
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: reqUrl,
      requestId,
    });
  }
}
