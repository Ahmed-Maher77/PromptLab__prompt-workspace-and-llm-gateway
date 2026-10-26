/**
 * Internal fallback token estimator for PromptLab.
 * Explicitly labeled as 'heuristic:chars/4'.
 *
 * NOTE: Application code and API responses must use TokenCounterService
 * with model-aware tiktoken encodings. This heuristic remains strictly as the
 * last-resort internal fallback if a tokenizer cannot be loaded.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text || text.trim().length === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}
