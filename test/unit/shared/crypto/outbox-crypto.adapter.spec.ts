import { describe, expect, it } from 'vitest';
import { OutboxCryptoAdapter } from '../../../../src/shared/infrastructure/crypto/outbox-crypto.adapter.js';
describe('outbox envelope crypto', () => {
  const adapter = new OutboxCryptoAdapter(Buffer.alloc(32, 7));
  it('round trips a versioned authenticated envelope', () => {
    const value = { to: 'owner@example.test', subject: 'OTP', text: 'code' };
    expect(adapter.decrypt(adapter.encrypt(value))).toEqual(value);
  });
  it('rejects tampering', () => {
    const payload = adapter.encrypt({ to: 'a@b.test', subject: 'x', text: 'y' });
    payload[payload.length - 1] = (payload.at(-1) ?? 0) ^ 1;
    expect(() => adapter.decrypt(payload)).toThrow();
  });
});
