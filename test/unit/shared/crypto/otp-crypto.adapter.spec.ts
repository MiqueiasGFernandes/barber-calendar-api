import { describe, expect, it } from 'vitest';
import { CryptoOtpAdapter } from '../../../../src/shared/infrastructure/crypto/otp-crypto.adapter.js';
describe('OTP crypto', () => {
  const adapter = new CryptoOtpAdapter('p'.repeat(32));
  it('generates exactly six decimal digits without an unreachable prefix', () => {
    for (let i = 0; i < 1000; i++) expect(adapter.generate()).toMatch(/^\d{6}$/);
  });
  it('binds digest to challenge and purpose', () => {
    const digest = adapter.digest('a', 'login', '123456');
    expect(adapter.matches('a', 'login', '123456', digest)).toBe(true);
    expect(adapter.matches('b', 'login', '123456', digest)).toBe(false);
    expect(adapter.matches('a', 'registration', '123456', digest)).toBe(false);
  });
  it('rejects differently sized digests safely', () =>
    expect(adapter.matches('a', 'login', '123456', Buffer.alloc(1))).toBe(false));
});
