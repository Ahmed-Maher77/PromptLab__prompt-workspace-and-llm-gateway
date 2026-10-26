import { Test, TestingModule } from '@nestjs/testing';
import { TokenCounterService } from './token-counter.service';

describe('TokenCounterService (TOKEN-01)', () => {
  let service: TokenCounterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TokenCounterService],
    }).compile();

    service = module.get<TokenCounterService>(TokenCounterService);
    service.clearCache();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveEncoding (TOKEN-01a)', () => {
    it('resolves OpenAI and modern reasoning models to o200k_base with exact method', () => {
      const cases = [
        { model: 'gpt-4o-mini', provider: 'openai' },
        { model: 'gpt-4.1', provider: 'openai' },
        { model: 'gpt-4.1-mini', provider: undefined },
        { model: 'gpt-5', provider: 'openai' },
        { model: 'o4-mini', provider: undefined },
      ];

      for (const c of cases) {
        const res = service.resolveEncoding(c.model, c.provider);
        expect(res.encodingName).toBe('o200k_base');
        expect(res.method).toBe('tiktoken:o200k_base');
      }
    });

    it('resolves explicit legacy OpenAI list to cl100k_base with exact method', () => {
      const cases = [
        'gpt-4',
        'gpt-4-0613',
        'gpt-4-32k-0613',
        'gpt-4-turbo',
        'gpt-3.5-turbo',
        'text-embedding-ada-002',
        'text-embedding-3-small',
      ];

      for (const m of cases) {
        const res = service.resolveEncoding(m, 'openai');
        expect(res.encodingName).toBe('cl100k_base');
        expect(res.method).toBe('tiktoken:cl100k_base');
      }
    });

    it('resolves Anthropic and unknown providers to o200k_base labeled as approximate', () => {
      const cases = [
        { model: 'claude-3-5-sonnet', provider: 'anthropic' },
        { model: 'claude-3-opus', provider: undefined },
        { model: 'unknown-model', provider: undefined },
        { model: 'llama-3-70b', provider: 'meta' },
      ];

      for (const c of cases) {
        const res = service.resolveEncoding(c.model, c.provider);
        expect(res.encodingName).toBe('o200k_base');
        expect(res.method).toBe('approximate:o200k_base');
      }
    });
  });

  describe('exact pinned fixtures', () => {
    it('counts exact tokens for pinned English text fixtures', () => {
      const res1 = service.countText('Hello, world!', 'gpt-4o');
      expect(res1.tokens).toBe(4);
      expect(res1.method).toBe('tiktoken:o200k_base');

      const res2 = service.countText('The quick brown fox jumps over the lazy dog.', 'gpt-4');
      expect(res2.tokens).toBe(10);
      expect(res2.method).toBe('tiktoken:cl100k_base');

      const s3 = 'PromptLab POC token counter test string with 12345 numbers and special chars: !@#$%^&*()';
      const res3 = service.countText(s3, 'gpt-4o');
      expect(res3.tokens).toBe(24);
      expect(res3.method).toBe('tiktoken:o200k_base');
    });

    it('counts Arabic text where chars/4 is severely inaccurate', () => {
      const arabic = 'مرحبا بكم في مختبر الأوامر'; // 26 chars -> chars/4 gives 7
      const chars4Estimate = Math.ceil(arabic.length / 4); // 7

      const resGpt4o = service.countText(arabic, 'gpt-4o');
      expect(resGpt4o.tokens).toBe(10);
      expect(resGpt4o.tokens).not.toBe(chars4Estimate);
      expect(resGpt4o.method).toBe('tiktoken:o200k_base');

      const resClaude = service.countText(arabic, 'claude-3-5-sonnet');
      expect(resClaude.tokens).toBe(10);
      expect(resClaude.tokens).not.toBe(chars4Estimate);
      expect(resClaude.method).toBe('approximate:o200k_base');
    });

    it('counts CJK text where chars/4 is severely inaccurate', () => {
      const cjk = '这是一个用于测试分词器的中文句子。'; // 17 chars -> chars/4 gives 5
      const chars4Estimate = Math.ceil(cjk.length / 4); // 5

      const resGpt4o = service.countText(cjk, 'gpt-4o');
      expect(resGpt4o.tokens).toBe(12);
      expect(resGpt4o.tokens).not.toBe(chars4Estimate);
      expect(resGpt4o.method).toBe('tiktoken:o200k_base');

      const resClaude = service.countText(cjk, 'claude-3-5-sonnet');
      expect(resClaude.tokens).toBe(12);
      expect(resClaude.tokens).not.toBe(chars4Estimate);
      expect(resClaude.method).toBe('approximate:o200k_base');
    });
  });

  describe('chunking guard (TOKEN-01b)', () => {
    it('asserts guarded count is >= exact count and within 10% for a long CJK sample', () => {
      const cjkSample = '人工智能是一种模拟人类智能的技术，它能够执行学习、推理、自我纠错等复杂任务。'.repeat(18);
      expect(cjkSample.length).toBeGreaterThan(600);

      const rawTokenizer = service.getEncodingInstance('o200k_base');
      const exactTokens = rawTokenizer.encode(cjkSample).length;

      const result = service.countText(cjkSample, 'gpt-4o');

      expect(result.tokens).toBeGreaterThanOrEqual(exactTokens);
      expect(result.tokens).toBeLessThanOrEqual(Math.ceil(exactTokens * 1.10));
      expect(result.chunked).toBe(true);
    });
  });

  describe('message formatting overhead', () => {
    it('includes per-message framing tokens (3 per msg) and response priming (3)', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ];

      // system: 3 framing + role('system' = 1) + content('You are a helpful assistant.' = 6 in o200k) = 10
      // user: 3 framing + role('user' = 1) + content('Hello' = 1) = 5
      // priming: 3
      // Total = 10 + 5 + 3 = 18
      const result = service.countMessages(messages, 'gpt-4o');
      expect(result.tokens).toBe(18);
      expect(result.method).toBe('tiktoken:o200k_base');
    });

    it('prevents 10-message contexts from being undercounted vs raw content tokens', () => {
      const tenMessages = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'ping',
      }));

      // Raw content alone is just 10 * 1 = 10 tokens
      const rawContentTokens = tenMessages.reduce((sum, m) => sum + service.countText(m.content, 'gpt-4o').tokens, 0);
      expect(rawContentTokens).toBe(10);

      // With chat framing overhead: 10 * (3 framing + 1 role + 1 content) + 3 priming = 53 tokens
      const messageTokens = service.countMessages(tenMessages, 'gpt-4o');
      expect(messageTokens.tokens).toBe(53);
      expect(messageTokens.tokens).toBeGreaterThan(rawContentTokens);
    });
  });

  describe('LRU cache performance', () => {
    it('uses LRU cache hits to avoid re-tokenizing identical text', () => {
      const testString = 'Repeatable long context token estimation string for LRU testing';

      const initialSize = service.getLruCacheSize();
      expect(initialSize).toBe(0);

      // First call -> populates cache
      const first = service.countText(testString, 'gpt-4o');
      expect(service.getLruCacheSize()).toBe(1);

      // Spy on getEncodingInstance to verify tokenizer encode is not called again
      const tokenizer = service.getEncodingInstance('o200k_base');
      const encodeSpy = jest.spyOn(tokenizer, 'encode');

      // Second call -> cache hit
      const second = service.countText(testString, 'gpt-4o');
      expect(second.tokens).toBe(first.tokens);
      expect(encodeSpy).not.toHaveBeenCalled();

      encodeSpy.mockRestore();
    });

    it('bounds the LRU cache without unbounded growth', () => {
      // Feed more items than maxLruEntries (1000)
      for (let i = 0; i < 1050; i++) {
        service.countText(`Sample unique string index #${i}`, 'gpt-4o');
      }

      expect(service.getLruCacheSize()).toBeLessThanOrEqual(1000);
    });
  });

  describe('fallback behavior', () => {
    it('falls back to chars/4 heuristic and logs once if tokenizer throws', () => {
      jest.spyOn(service, 'getEncodingInstance').mockImplementationOnce(() => {
        throw new Error('Simulated tokenizer initialization failure');
      });

      const text = 'Fallback testing string';
      const result = service.countText(text, 'gpt-4o');

      expect(result.method).toBe('heuristic:chars/4');
      expect(result.tokens).toBe(Math.ceil(text.length / 4));
    });

    it('returns 0 tokens for empty or null text', () => {
      expect(service.countText('').tokens).toBe(0);
      expect(service.countText(null).tokens).toBe(0);
      expect(service.countText(undefined).tokens).toBe(0);
      expect(service.countMessages([]).tokens).toBe(0);
    });
  });
});
