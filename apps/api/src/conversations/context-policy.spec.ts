import {
  getModelContextPolicy,
  getMaxInputBudget,
  DEFAULT_UNKNOWN_CONTEXT_POLICY,
  assembleConversationContext,
  estimateTokens,
} from './context-policy';

describe('Context Policy (COST-01)', () => {
  describe('getModelContextPolicy', () => {
    it('returns known policy with window and budget when given a catalog entry', () => {
      const gptPolicy = getModelContextPolicy({
        maxInputTokens: 128_000,
        maxOutputTokens: 16_384,
        provider: 'openai',
      });
      expect(gptPolicy.status).toBe('known');
      expect(gptPolicy.contextWindow).toBe(128_000);
      expect(gptPolicy.defaultInputBudget).toBe(8192);
      expect(gptPolicy.reservedOutputTokens).toBe(16_384);
      expect(gptPolicy.sourceNote).toContain('Gateway model catalog specification');

      const claudePolicy = getModelContextPolicy({
        maxInputTokens: 200_000,
        maxOutputTokens: 8192,
        provider: 'anthropic',
      });
      expect(claudePolicy.status).toBe('known');
      expect(claudePolicy.contextWindow).toBe(200_000);
      expect(claudePolicy.defaultInputBudget).toBe(8192);
      expect(claudePolicy.reservedOutputTokens).toBe(8192);
    });

    it('returns unknown policy with safe fallback budget when no catalog entry or unknown entry', () => {
      const unknownPolicy = getModelContextPolicy(null);
      expect(unknownPolicy.status).toBe('unknown');
      expect(unknownPolicy.contextWindow).toBeNull();
      expect(unknownPolicy.defaultInputBudget).toBe(4096);
      expect(unknownPolicy.reservedOutputTokens).toBe(1024);
      expect(unknownPolicy.sourceNote).toContain('Context window metadata unavailable');

      const explicitUnknown = getModelContextPolicy({
        maxInputTokens: 4096,
        isUnknownDefault: true,
      });
      expect(explicitUnknown).toEqual(DEFAULT_UNKNOWN_CONTEXT_POLICY);
    });
  });

  describe('getMaxInputBudget', () => {
    it('calculates max input budget from contextWindow - reservedOutputTokens for known models', () => {
      const maxBudget = getMaxInputBudget({
        maxInputTokens: 128_000,
        maxOutputTokens: 4096,
        provider: 'openai',
      });
      expect(maxBudget).toBe(128_000 - 4096);
    });

    it('falls back to defaultInputBudget for unknown models', () => {
      const maxBudget = getMaxInputBudget(null);
      expect(maxBudget).toBe(4096);
    });
  });

  describe('assembleConversationContext with pure policy injection', () => {
    it('uses injected policy to evaluate budget limits', () => {
      const conv = {
        model: 'custom-model',
        provider: 'custom-provider',
        contextBudget: null,
        messages: [
          { role: 'system', content: 'You are helpful', sequenceNumber: 1, status: 'reconciled' },
        ],
      };

      const customPolicy = {
        contextWindow: 50000,
        status: 'known' as const,
        defaultInputBudget: 10000,
        reservedOutputTokens: 2000,
      };

      const result = assembleConversationContext(conv, 'Hello', customPolicy);
      expect(result.contextWindow).toBe(50000);
      expect(result.contextLimitStatus).toBe('known');
      expect(result.inputBudget).toBe(10000);
      expect(result.reservedOutputTokens).toBe(2000);
    });
  });

  describe('estimateTokens re-export', () => {
    it('re-exports the shared estimateTokens accurately', () => {
      expect(estimateTokens('hello world')).toBe(3);
    });
  });
});
