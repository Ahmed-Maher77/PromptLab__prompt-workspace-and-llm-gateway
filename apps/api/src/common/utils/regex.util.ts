export interface CompiledRegexResult {
  test?: (input: string) => boolean;
  passedIfMissing?: boolean;
  error?: string;
}

// Safely attempt to load native RE2 addon; fallback if native build is absent
let RE2Constructor: any = null;
try {
  RE2Constructor = require('re2');
} catch {
  RE2Constructor = null;
}

/**
 * Compiles a user-supplied regex pattern using linear-time RE2 when available.
 * Caps pattern length to 256 characters and evaluation input slice to 64 KB.
 * Returns a compiled test function or an error description.
 */
export function compileSafeRegex(rawPattern: string | undefined | null): CompiledRegexResult {
  const pattern = (rawPattern || '').trim();

  if (pattern.length === 0) {
    return { error: 'Regex pattern is empty' };
  }

  if (pattern.length > 256) {
    return { error: 'Regex pattern exceeds maximum allowed length of 256 characters' };
  }

  // 1. Try linear-time RE2 engine first (protects against catastrophic backtracking)
  if (RE2Constructor) {
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

  // 2. Fallback to standard RegExp if RE2 native binary is unavailable
  try {
    const re = new RegExp(pattern, 'i');
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
