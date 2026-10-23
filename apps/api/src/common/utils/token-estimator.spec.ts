import { estimateTokens } from './token-estimator';

describe('estimateTokens', () => {
  it('returns 0 for empty, null, undefined, or whitespace-only inputs', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
    expect(estimateTokens('   \t\n  ')).toBe(0);
  });

  it('estimates tokens based on the 4 characters per token heuristic', () => {
    // 4 chars -> 1 token
    expect(estimateTokens('abcd')).toBe(1);
    // 5 chars -> ceil(5/4) = 2 tokens
    expect(estimateTokens('abcde')).toBe(2);
    // 8 chars -> 2 tokens
    expect(estimateTokens('12345678')).toBe(2);
    // 9 chars -> ceil(9/4) = 3 tokens
    expect(estimateTokens('123456789')).toBe(3);
  });

  it('returns at least 1 token for non-empty short strings', () => {
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('!')).toBe(1);
  });

  it('estimates long structured prompts and code snippets accurately', () => {
    const prompt = 'You are a senior software architect specializing in distributed event-driven systems.';
    const expected = Math.ceil(prompt.length / 4);
    expect(estimateTokens(prompt)).toBe(expected);
  });
});
