/**
 * Cost calculator for model token usage.
 * Pricing is expressed in USD per 1 Million tokens.
 * Only returns a cost if exact pricing is known; otherwise returns null.
 * 
 * Note: Rates reflect standard published vendor API pricing as of October 2024.
 * Figures are configurable estimates for engineering comparisons, not real-time
 * financial ledger statements or live vendor invoice guarantees.
 */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  currency: 'USD';
  effectiveAsOf: string;
  source: string;
}

export const KNOWN_MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': {
    inputPerMillion: 0.15,
    outputPerMillion: 0.60,
    currency: 'USD',
    effectiveAsOf: '2024-10-01',
    source: 'OpenAI Published API Pricing (Oct 2024)',
  },
  'gpt-4o': {
    inputPerMillion: 2.50,
    outputPerMillion: 10.00,
    currency: 'USD',
    effectiveAsOf: '2024-10-01',
    source: 'OpenAI Published API Pricing (Oct 2024)',
  },
  'claude-3-5-sonnet': {
    inputPerMillion: 3.00,
    outputPerMillion: 15.00,
    currency: 'USD',
    effectiveAsOf: '2024-10-01',
    source: 'Anthropic Published API Pricing (Oct 2024)',
  },
};

/**
 * Allows registering or overriding pricing for custom or newer models at runtime.
 */
export function registerModelPricing(model: string, pricing: ModelPricing): void {
  KNOWN_MODEL_PRICING[model.toLowerCase()] = pricing;
}

/**
 * Strips known vendor prefixes (e.g. openai/gpt-4o -> gpt-4o).
 */
export function normalizeModelName(model: string): string {
  const lower = (model || '').toLowerCase().trim();
  const slashIdx = lower.lastIndexOf('/');
  return slashIdx !== -1 ? lower.substring(slashIdx + 1) : lower;
}

export function getModelPricing(model: string): ModelPricing | null {
  const key = (model || '').toLowerCase().trim();
  const normalized = normalizeModelName(model);
  return KNOWN_MODEL_PRICING[key] || KNOWN_MODEL_PRICING[normalized] || null;
}

export interface CostCalculationResult {
  estimatedCost: number | null;
  isEstimate: boolean;
  pricingSource: string | null;
  effectiveAsOf: string | null;
}

export function calculateCostDetails(
  model: string,
  inputTokens: number,
  outputTokens: number,
): CostCalculationResult {
  const pricing = getModelPricing(model);
  if (!pricing) {
    return {
      estimatedCost: null,
      isEstimate: true,
      pricingSource: null,
      effectiveAsOf: null,
    };
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const totalCost = inputCost + outputCost;

  return {
    estimatedCost: Math.round(totalCost * 1_000_000) / 1_000_000,
    isEstimate: true,
    pricingSource: pricing.source,
    effectiveAsOf: pricing.effectiveAsOf,
  };
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  return calculateCostDetails(model, inputTokens, outputTokens).estimatedCost;
}
