import {
  fromApiTokenUsageSource,
  fromApiUsageStatus,
  toApiTokenUsageSource,
  toApiUsageStatus,
  toUsageOperation,
} from './usage.enums';

describe('usage enum boundary helpers', () => {
  it('maps hyphenated API statuses to database enum names and back', () => {
    expect(fromApiUsageStatus('timeout-ambiguous')).toBe('timeout_ambiguous');
    expect(toApiUsageStatus('timeout_ambiguous')).toBe('timeout-ambiguous');
  });

  it('round-trips every usage status', () => {
    for (const status of [
      'reserved',
      'reconciling',
      'reconciled',
      'failed',
      'timeout-ambiguous',
      'expired',
    ]) {
      expect(toApiUsageStatus(fromApiUsageStatus(status))).toBe(status);
    }
  });

  it('maps hyphenated token usage sources and back', () => {
    expect(fromApiTokenUsageSource('provider-reported')).toBe('provider_reported');
    expect(fromApiTokenUsageSource('estimated-timeout')).toBe('estimated_timeout');
    expect(toApiTokenUsageSource('provider_reported')).toBe('provider-reported');
    expect(toApiTokenUsageSource('estimated_timeout')).toBe('estimated-timeout');
    expect(toApiTokenUsageSource('estimated')).toBe('estimated');
  });

  it('rejects unknown values', () => {
    expect(() => fromApiUsageStatus('pending')).toThrow('Unknown usage status');
    expect(() => fromApiUsageStatus('timeout_ambiguous')).toThrow();
    expect(() => fromApiTokenUsageSource('provider_reported')).toThrow();
  });

  it('maps pipeline operations to usage operations', () => {
    expect(toUsageOperation('playground.execute')).toBe('playground');
    expect(toUsageOperation('comparison.slot')).toBe('comparison');
    expect(toUsageOperation('conversation.turn')).toBe('conversation');
    expect(toUsageOperation('compaction.preview')).toBe('compaction');
    expect(toUsageOperation('gateway.request')).toBe('gateway');
    expect(() => toUsageOperation('other.thing')).toThrow('Unknown LLM operation');
  });
});
