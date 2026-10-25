/**
 * Safe UUID v4 generator for client-side idempotency keys.
 * Uses `crypto.randomUUID()` when available in secure contexts (HTTPS/localhost).
 * Falls back to `crypto.getRandomValues()` UUID v4 generation when running in
 * non-secure contexts (e.g. HTTP over LAN or non-secure test environments).
 */
export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // Per RFC 4122 v4:
    // Set version bits (bits 12-15 of time_hi_and_version to 0100 -> 0x40)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // Set variant bits (bits 6-7 of clock_seq_hi_and_reserved to 10 -> 0x80)
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Fallback for environments lacking Web Crypto API
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
