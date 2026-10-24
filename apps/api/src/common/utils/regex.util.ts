import { Logger } from '@nestjs/common';
import type RE2 from 're2';

export interface CompiledRegexResult {
  test?: (input: string) => boolean;
  passedIfMissing?: boolean;
  error?: string;
}

const logger = new Logger('RegexUtil');

type RE2ConstructorType = typeof RE2;

// Safely attempt to load native RE2 addon; fail closed if absent
let RE2Constructor: RE2ConstructorType | null = null;
try {
  RE2Constructor = require('re2');
} catch (err) {
  RE2Constructor = null;
  logger.error(
    'Safe regex engine (re2) failed to load native addon; regex criteria will fail closed',
    err instanceof Error ? err.stack : String(err),
  );
}

/**
 * Compiles a user-supplied regex pattern using linear-time RE2.
 * Fails closed if RE2 failed to load at module initialization.
 * Caps pattern length to 256 characters and evaluation input slice to 64 KB.
 * Returns a compiled test function or an error description.
 */
export function compileSafeRegex(rawPattern: string | undefined | null): CompiledRegexResult {
  if (!RE2Constructor) {
    return { error: 'Regex criteria are unavailable: safe regex engine (re2) failed to load' };
  }

  const pattern = (rawPattern || '').trim();

  if (pattern.length === 0) {
    return { error: 'Regex pattern is empty' };
  }

  if (pattern.length > 256) {
    return { error: 'Regex pattern exceeds maximum allowed length of 256 characters' };
  }

  try {
    const re = new RE2Constructor(pattern, 'i');
    return {
      test: (input: string) => {
        const target = input.length > 65536 ? input.slice(0, 65536) : input;
        return re.test(target);
      },
    };
  } catch {
    return { error: 'Invalid regular expression' };
  }
}
