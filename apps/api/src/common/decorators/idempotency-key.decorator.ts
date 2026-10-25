import { createParamDecorator, ExecutionContext, BadRequestException } from '@nestjs/common';

export const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Extracts and validates the `Idempotency-Key` header.
 * Allowed characters: ^[A-Za-z0-9._:-]{8,128}$
 * Throws BadRequestException (HTTP 400) if the header is present and invalid.
 * Returns undefined if the header was omitted.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    const rawHeader =
      request.headers['idempotency-key'] ?? request.headers['Idempotency-Key'];

    if (rawHeader === undefined || rawHeader === null) {
      return undefined;
    }

    const value = Array.isArray(rawHeader) ? rawHeader[0] : String(rawHeader);

    if (!IDEMPOTENCY_KEY_REGEX.test(value)) {
      throw new BadRequestException(
        'Invalid Idempotency-Key header format. Key must match ^[A-Za-z0-9._:-]{8,128}$',
      );
    }

    return value;
  },
);
