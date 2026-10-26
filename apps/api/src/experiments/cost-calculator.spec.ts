import { calculateCost, calculateCostFromRates } from './cost-calculator';

describe('Cost Calculator', () => {
  it('calculates cost accurately given per-token rates', () => {
    // e.g. gpt-4o-mini rates: $0.00000015 input, $0.00000060 output
    const cost = calculateCost(1000, 500, 0.00000015, 0.0000006);
    // (1000 * 0.00000015) + (500 * 0.00000060) = 0.00015 + 0.00030 = 0.00045
    expect(cost).toBe(0.00045);
  });

  it('calculates cost accurately with calculateCostFromRates and includes source', () => {
    const details = calculateCostFromRates(1000, 1000, {
      inputCostPerToken: 0.000003,
      outputCostPerToken: 0.000015,
      source: 'litellm-model-info',
    });
    expect(details.estimatedCost).toBe(0.018);
    expect(details.pricingSource).toBe('litellm-model-info');
    expect(details.isEstimate).toBe(true);
  });

  it('returns null if rates are null or undefined (no made-up numbers)', () => {
    expect(calculateCost(500, 200, null, null)).toBeNull();
    expect(calculateCost(500, 200, 0.000001, null)).toBeNull();
    expect(calculateCost(500, 200, null, 0.000002)).toBeNull();
    expect(calculateCost(500, 200)).toBeNull();
  });
});
