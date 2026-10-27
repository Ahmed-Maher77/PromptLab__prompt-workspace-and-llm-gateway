import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { getEncoding, Tiktoken } from 'js-tiktoken';
import { estimateTokens as fallbackEstimateTokens } from '../common/utils/token-estimator';
import {
  TokenCountResult,
  TokenEstimationMethod,
  ChatMessageLike,
} from './tokens.types';

@Injectable()
export class TokenCounterService {
  private readonly logger = new Logger(TokenCounterService.name);
  private readonly encodings = new Map<'o200k_base' | 'cl100k_base', Tiktoken>();
  private readonly lruCache = new Map<string, { tokens: number; chunked?: boolean }>();
  private readonly maxLruEntries = 1000;
  private hasLoggedFallback = false;

  /**
   * Maps model and provider to appropriate tiktoken encoding.
   * - Explicit legacy OpenAI list -> cl100k_base ('tiktoken:cl100k_base'):
   *   gpt-4, gpt-4-0613, gpt-4-32k*, gpt-4-turbo*, gpt-3.5-turbo*, text-embedding-ada-002, text-embedding-3-*
   * - Default for OpenAI and OpenAI-like models -> o200k_base ('tiktoken:o200k_base')
   * - Anthropic and unknown providers -> o200k_base ('approximate:o200k_base')
   */
  resolveEncoding(
    model?: string,
    provider?: string,
  ): {
    encodingName: 'o200k_base' | 'cl100k_base';
    method: TokenEstimationMethod;
  } {
    const normModel = (model || '').toLowerCase().trim();
    const normProvider = (provider || '').toLowerCase().trim();

    // 1. Explicit legacy OpenAI list -> cl100k_base (exact)
    const isLegacyCl100k =
      normModel === 'gpt-4' ||
      normModel === 'gpt-4-0613' ||
      normModel.startsWith('gpt-4-32k') ||
      normModel.startsWith('gpt-4-turbo') ||
      normModel.startsWith('gpt-3.5-turbo') ||
      normModel === 'text-embedding-ada-002' ||
      normModel.startsWith('text-embedding-3');

    if (isLegacyCl100k) {
      return {
        encodingName: 'cl100k_base',
        method: 'tiktoken:cl100k_base',
      };
    }

    // 2. Default for OpenAI and OpenAI-like models -> o200k_base (exact)
    const isOpenAi =
      normProvider === 'openai' ||
      normModel.startsWith('gpt-') ||
      normModel.startsWith('o1') ||
      normModel.startsWith('o2') ||
      normModel.startsWith('o3') ||
      normModel.startsWith('o4') ||
      normModel.includes('chatgpt') ||
      normModel.startsWith('text-embedding');

    if (isOpenAi) {
      return {
        encodingName: 'o200k_base',
        method: 'tiktoken:o200k_base',
      };
    }

    // 3. Anthropic and unknown providers -> o200k_base (approximate proxy for modern LLMs)
    return {
      encodingName: 'o200k_base',
      method: 'approximate:o200k_base',
    };
  }

  /**
   * Lazily loads and caches tiktoken encoding tables.
   */
  getEncodingInstance(encodingName: 'o200k_base' | 'cl100k_base'): Tiktoken {
    let instance = this.encodings.get(encodingName);
    if (!instance) {
      instance = getEncoding(encodingName);
      this.encodings.set(encodingName, instance);
    }
    return instance;
  }

  /**
   * Counts tokens in a plain text string using the appropriate tokenizer,
   * with bounded LRU caching.
   */
  countText(
    text: string | null | undefined,
    model?: string,
    provider?: string,
  ): TokenCountResult {
    if (text === null || text === undefined || text === '') {
      const { method } = this.resolveEncoding(model, provider);
      return { tokens: 0, method };
    }

    const { encodingName, method } = this.resolveEncoding(model, provider);

    try {
      const raw = this.countRawTextWithCache(text, encodingName);
      return { tokens: raw.tokens, method, ...(raw.chunked ? { chunked: true } : {}) };
    } catch (err: unknown) {
      this.logFallbackOnce(err);
      return { tokens: fallbackEstimateTokens(text), method: 'heuristic:chars/4' };
    }
  }

  /**
   * Counts tokens in chat messages including framing/role overhead.
   * Standard ChatML format: 3 tokens framing per message + 3 tokens reply priming.
   */
  countMessages(
    messages: ChatMessageLike[],
    model?: string,
    provider?: string,
  ): TokenCountResult {
    if (!messages || messages.length === 0) {
      const { method } = this.resolveEncoding(model, provider);
      return { tokens: 0, method };
    }

    const { encodingName, method } = this.resolveEncoding(model, provider);

    try {
      let totalTokens = 0;
      let wasChunked = false;
      for (const msg of messages) {
        // 3 tokens overhead per message: <|im_start|>{role}\n...<|im_end|>\n
        totalTokens += 3;
        if (msg.role) {
          const rawRole = this.countRawTextWithCache(msg.role, encodingName);
          totalTokens += rawRole.tokens;
          if (rawRole.chunked) wasChunked = true;
        }
        if (msg.content) {
          const rawContent = this.countRawTextWithCache(msg.content, encodingName);
          totalTokens += rawContent.tokens;
          if (rawContent.chunked) wasChunked = true;
        }
      }
      totalTokens += 3; // Assistant response primer

      return { tokens: totalTokens, method, ...(wasChunked ? { chunked: true } : {}) };
    } catch (err: unknown) {
      this.logFallbackOnce(err);
      let fallbackTotal = 3;
      for (const msg of messages) {
        fallbackTotal += 3 + fallbackEstimateTokens(msg.role) + fallbackEstimateTokens(msg.content);
      }
      return { tokens: fallbackTotal, method: 'heuristic:chars/4' };
    }
  }

  /**
   * Generic token counting helper supporting either raw string or chat messages array.
   */
  count(
    input: string | ChatMessageLike[] | null | undefined,
    model?: string,
    provider?: string,
  ): TokenCountResult {
    if (Array.isArray(input)) {
      return this.countMessages(input, model, provider);
    }
    return this.countText(input, model, provider);
  }

  /**
   * Creates a pure counter function suitable for injection into context assembly.
   */
  createCounter(
    model?: string,
    provider?: string,
  ): (text: string) => { tokens: number; method: TokenEstimationMethod; chunked?: boolean } {
    return (text: string) => this.countText(text, model, provider);
  }

  /**
   * Tokenizes text with bounded LRU caching.
   */
  private countRawTextWithCache(
    text: string,
    encodingName: 'o200k_base' | 'cl100k_base',
  ): { tokens: number; chunked?: boolean } {
    const key = `${encodingName}:${this.hashContent(text)}`;

    const cached = this.lruCache.get(key);
    if (cached !== undefined) {
      // Re-insert to refresh LRU order
      this.lruCache.delete(key);
      this.lruCache.set(key, cached);
      return cached;
    }

    const tokenizer = this.getEncodingInstance(encodingName);
    const result = this.encodeSafely(tokenizer, text);

    // Enforce bounded LRU cache size
    if (this.lruCache.size >= this.maxLruEntries) {
      const oldestKey = this.lruCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.lruCache.delete(oldestKey);
      }
    }
    this.lruCache.set(key, result);

    return result;
  }

  /**
   * Safely encodes text avoiding quadratic pure-JS BPE merge loops on pathologically
   * long unbroken strings (e.g. 32k repeated characters without whitespace).
   */
  encodeSafely(tokenizer: Tiktoken, text: string): { tokens: number; chunked?: boolean } {
    if (text.length <= 128 || (text.length <= 1024 && /\s/.test(text)) || !/[^\s]{129,}/.test(text)) {
      return { tokens: tokenizer.encode(text).length };
    }

    let total = 0;
    let wasChunked = false;
    const parts = text.split(/(\s+)/);
    let buffer = '';

    for (const part of parts) {
      if (part.length > 128 && !/^\s+$/.test(part)) {
        wasChunked = true;
        if (buffer) {
          total += tokenizer.encode(buffer).length;
          buffer = '';
        }
        for (let i = 0; i < part.length; i += 64) {
          total += tokenizer.encode(part.slice(i, i + 64)).length;
        }
      } else {
        if (buffer.length + part.length > 2048) {
          total += tokenizer.encode(buffer).length;
          buffer = part;
        } else {
          buffer += part;
        }
      }
    }

    if (buffer) {
      total += tokenizer.encode(buffer).length;
    }

    return { tokens: total, ...(wasChunked ? { chunked: true } : {}) };
  }

  private hashContent(content: string): string {
    if (content.length < 64) {
      return content;
    }
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private logFallbackOnce(err: unknown): void {
    if (!this.hasLoggedFallback) {
      this.hasLoggedFallback = true;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`js-tiktoken tokenizer unavailable; falling back to chars/4 heuristic: ${msg}`);
    }
  }

  /**
   * Clears internal LRU cache and resets single-log fallback flag (for testing).
   */
  clearCache(): void {
    this.lruCache.clear();
    this.hasLoggedFallback = false;
  }

  getLruCacheSize(): number {
    return this.lruCache.size;
  }
}
