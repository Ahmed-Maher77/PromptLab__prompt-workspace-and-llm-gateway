/**
 * Cost calculator for model token usage.
 * Pricing is expressed in USD per 1 Million tokens.
 * Only returns a cost if exact pricing is known; otherwise returns null.
 */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const KNOWN_MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': {
    inputPerMillion: 0.15,
    outputPerMillion: 0.60,
  },
  'claude-3-5-sonnet': {
    inputPerMillion: 3.00,
    outputPerMillion: 15.00,
  },
};

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const pricing = KNOWN_MODEL_PRICING[model.toLowerCase()];
  if (!pricing) {
    return null;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const totalCost = inputCost + outputCost;

  // Round to 6 decimal places for precision without floating point noise
  return Math.round(totalCost * 1_000_000) / 1_000_000;
}
