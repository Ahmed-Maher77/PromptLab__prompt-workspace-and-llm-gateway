import { calculateCost } from './cost-calculator';

describe('Cost Calculator', () => {
  it('should calculate cost accurately for gpt-4o-mini', () => {
    // 1,000,000 prompt tokens = $0.15, 1,000,000 completion tokens = $0.60
    const cost = calculateCost('gpt-4o-mini', 1000, 500);
    // (1000 / 1e6)*0.15 + (500 / 1e6)*0.60 = 0.00015 + 0.00030 = 0.00045
    expect(cost).toBe(0.00045);
  });

  it('should calculate cost accurately for claude-3-5-sonnet', () => {
    // 1000 prompt tokens = $0.003, 1000 completion tokens = $0.015
    const cost = calculateCost('claude-3-5-sonnet', 1000, 1000);
    expect(cost).toBe(0.018);
  });

  it('should return null if model pricing is unknown (no fake numbers)', () => {
    const cost = calculateCost('custom-unknown-model', 500, 200);
    expect(cost).toBeNull();
  });
});
