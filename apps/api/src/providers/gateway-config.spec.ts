import * as fs from 'fs';
import * as path from 'path';

/**
 * Guards the timing contract between the LiteLLM gateway config and the API (see ADR-015).
 * The API aborts a provider call after LLM_REQUEST_TIMEOUT_MS (default 30 000 ms). If the gateway's
 * per-attempt timeout were longer, or if it retried timeouts, the API would abort while LiteLLM is
 * still working and the call would be recorded as an ambiguous, partially charged timeout.
 */
describe('LiteLLM gateway config (infra/litellm/config.yaml)', () => {
  const configPath = path.resolve(__dirname, '../../../../infra/litellm/config.yaml');
  const config = fs.readFileSync(configPath, 'utf8');
  const DEFAULT_API_TIMEOUT_MS = 30_000;

  /** Reads `key: <integer>` from the YAML, ignoring trailing comments. */
  const intSetting = (key: string): number => {
    const match = config.match(new RegExp(`^\\s*${key}:\\s*(\\d+)`, 'm'));
    if (!match) throw new Error(`${key} not found in ${configPath}`);
    return parseInt(match[1], 10);
  };

  it('uses a per-attempt request_timeout shorter than the API request timeout', () => {
    const requestTimeoutMs = intSetting('request_timeout') * 1000;
    expect(requestTimeoutMs).toBeLessThan(DEFAULT_API_TIMEOUT_MS);
  });

  it('never retries timeouts', () => {
    expect(intSetting('TimeoutErrorRetries')).toBe(0);
  });

  it('does not retry errors a retry cannot fix', () => {
    for (const key of [
      'AuthenticationErrorRetries',
      'BadRequestErrorRetries',
      'NotFoundErrorRetries',
      'ContentPolicyViolationErrorRetries',
    ]) {
      expect(intSetting(key)).toBe(0);
    }
  });

  it('retries transient upstream failures', () => {
    expect(intSetting('RateLimitErrorRetries')).toBeGreaterThan(0);
    expect(intSetting('ServiceUnavailableErrorRetries')).toBeGreaterThan(0);
  });

  it('keeps every model the gateway serves on an environment-provided key', () => {
    const apiKeys = config.match(/^\s*api_key:\s*(.+)$/gm) ?? [];
    expect(apiKeys.length).toBeGreaterThan(0);
    for (const line of apiKeys) {
      expect(line).toMatch(/os\.environ\//);
    }
  });
});
