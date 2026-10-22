/**
 * Shared token count estimator for PromptLab.
 * Explicitly labeled as 'estimated' heuristic.
 * Standard heuristic: ~4 characters per token for typical English and code text.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text || text.trim().length === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}
