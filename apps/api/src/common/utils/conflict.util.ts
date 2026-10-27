import { ConflictException } from '@nestjs/common';

/**
 * Creates a machine-readable ConflictException carrying an explicit code
 * in addition to message for RFC 9457 Problem Details responses.
 */
export function conflict(code: string, message?: string): ConflictException {
  return new ConflictException({
    message: message || code,
    code,
  });
}
