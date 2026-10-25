import { generateIdempotencyKey } from './uuid.util';

describe('generateIdempotencyKey', () => {
  it('generates a valid UUID string matching regex', () => {
    const key = generateIdempotencyKey();
    expect(key).toBeTruthy();
    expect(key).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('falls back to crypto.getRandomValues when crypto.randomUUID is undefined (insecure context)', () => {
    const originalCrypto = window.crypto;
    const mockCrypto = {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = i * 17;
        }
        return arr;
      },
    };

    // Temporarily delete or override randomUUID
    Object.defineProperty(window, 'crypto', {
      value: mockCrypto,
      configurable: true,
      writable: true,
    });

    try {
      const key = generateIdempotencyKey();
      expect(key).toBeTruthy();
      expect(key).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
      expect(key.length).toBe(36);
    } finally {
      Object.defineProperty(window, 'crypto', {
        value: originalCrypto,
        configurable: true,
        writable: true,
      });
    }
  });
});
