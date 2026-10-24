import { compileSafeRegex } from './regex.util';

describe('compileSafeRegex', () => {
  it('should compile valid regex patterns and match target strings', () => {
    const compiled = compileSafeRegex('order\\s*#?\\d+');
    expect(compiled.error).toBeUndefined();
    expect(compiled.test).toBeDefined();
    expect(compiled.test!('Your Order #4567 is ready')).toBe(true);
    expect(compiled.test!('Hello world')).toBe(false);
  });

  it('should reject empty or whitespace-only patterns', () => {
    const emptyResult = compileSafeRegex('');
    expect(emptyResult.error).toBe('Regex pattern is empty');
    expect(emptyResult.test).toBeUndefined();

    const whitespaceResult = compileSafeRegex('   ');
    expect(whitespaceResult.error).toBe('Regex pattern is empty');
  });

  it('should reject patterns exceeding 256 characters', () => {
    const longPattern = 'a'.repeat(257);
    const result = compileSafeRegex(longPattern);
    expect(result.error).toBe('Regex pattern exceeds maximum allowed length of 256 characters');
  });

  it('should evaluate ReDoS patterns in linear time without hanging', () => {
    const compiled = compileSafeRegex('(a|aa)+$');
    expect(compiled.error).toBeUndefined();
    expect(compiled.test).toBeDefined();

    const tenKb = 'a'.repeat(10000) + '!';
    const start = Date.now();
    const matched = compiled.test!(tenKb);
    const elapsed = Date.now() - start;

    expect(matched).toBe(false);
    expect(elapsed).toBeLessThan(1000);
  });

  it('should report informative error for uncompilable or unsupported patterns', () => {
    const broken = compileSafeRegex('[a-z');
    expect(broken.error).toBeDefined();
    expect(broken.error).toBe('Invalid regular expression');
  });

  it('should fail closed when re2 fails to load', () => {
    jest.isolateModules(() => {
      jest.doMock('re2', () => {
        throw new Error('Native addon missing');
      });
      const { compileSafeRegex: isolatedCompile } = require('./regex.util');
      const result = isolatedCompile('(a|aa)+$');
      expect(result.error).toBe('Regex criteria are unavailable: safe regex engine (re2) failed to load');
      expect(result.test).toBeUndefined();
    });
  });
});
