/**
 * Pure token cost calculation utilities.
 * All model pricing is dynamically fetched and cached from LiteLLM GET /model/info
 * Via ModelCatalogService. Static pricing tables are eliminated.
 */

export interface TokenPricingRates {
  inputCostPerToken: number | null;
  outputCostPerToken: number | null;
  source?: string;
  effectiveAsOf?: string;
}

export interface CostCalculationResult {
  estimatedCost: number | null;
  isEstimate: boolean;
  pricingSource: string | null;
  effectiveAsOf: string | null;
}

/**
 * Calculates token cost given explicit input/output rates per token.
 * Returns null if rates are unknown or incomplete (no made-up prices).
 */
export function calculateCostFromRates(
  inputTokens: number,
  outputTokens: number,
  rates?: TokenPricingRates | null,
): CostCalculationResult {
  if (
    !rates ||
    rates.inputCostPerToken === null ||
    rates.inputCostPerToken === undefined ||
    rates.outputCostPerToken === null ||
    rates.outputCostPerToken === undefined
  ) {
    return {
      estimatedCost: null,
      isEstimate: true,
      pricingSource: null,
      effectiveAsOf: null,
    };
  }

  const inputCost = inputTokens * rates.inputCostPerToken;
  const outputCost = outputTokens * rates.outputCostPerToken;
  const totalCost = inputCost + outputCost;

  return {
    estimatedCost: Math.round(totalCost * 1_000_000) / 1_000_000,
    isEstimate: true,
    pricingSource: rates.source || 'gateway-catalog',
    effectiveAsOf: rates.effectiveAsOf || null,
  };
}

/**
 * Calculates cost for given input and output tokens using per-token rates.
 * Returns null if pricing is unknown.
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  inputCostPerToken?: number | null,
  outputCostPerToken?: number | null,
): number | null {
  return calculateCostFromRates(inputTokens, outputTokens, {
    inputCostPerToken: inputCostPerToken ?? null,
    outputCostPerToken: outputCostPerToken ?? null,
  }).estimatedCost;
}
