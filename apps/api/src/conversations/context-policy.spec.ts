import {
  getModelContextPolicy,
  KNOWN_MODEL_CONTEXT_LIMITS,
  estimateTokens,
} from './context-policy';

describe('Context Policy', () => {
  describe('getModelContextPolicy', () => {
    it('returns known policy with window and budget for recognized models', () => {
      const gptPolicy = getModelContextPolicy('gpt-4o-mini');
      expect(gptPolicy.status).toBe('known');
      expect(gptPolicy.contextWindow).toBe(128_000);
      expect(gptPolicy.defaultInputBudget).toBe(8192);
      expect(gptPolicy.reservedOutputTokens).toBe(1024);
      expect(gptPolicy.sourceNote).toBe('Vendor published context window specification');

      const claudePolicy = getModelContextPolicy('Claude-3-5-Sonnet');
      expect(claudePolicy.status).toBe('known');
      expect(claudePolicy.contextWindow).toBe(200_000);
    });

    it('returns unknown policy with safe fallback budget for unrecognized models', () => {
      const unknownPolicy = getModelContextPolicy('custom-llama-3-8b');
      expect(unknownPolicy.status).toBe('unknown');
      expect(unknownPolicy.contextWindow).toBeNull();
      expect(unknownPolicy.defaultInputBudget).toBe(4096);
      expect(unknownPolicy.reservedOutputTokens).toBe(1024);
      expect(unknownPolicy.sourceNote).toContain('Context window metadata unavailable');
    });

    it('handles all entries in KNOWN_MODEL_CONTEXT_LIMITS', () => {
      for (const [modelName, limit] of Object.entries(KNOWN_MODEL_CONTEXT_LIMITS)) {
        const policy = getModelContextPolicy(modelName);
        expect(policy.status).toBe('known');
        expect(policy.contextWindow).toBe(limit);
      }
    });
  });

  describe('estimateTokens re-export', () => {
    it('re-exports the shared estimateTokens accurately', () => {
      expect(estimateTokens('hello world')).toBe(3);
    });
  });
});
