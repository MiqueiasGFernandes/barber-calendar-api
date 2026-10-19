import { describe, expect, it } from 'vitest';
import { AesGcmIdempotencyCipher } from '../../../src/modules/scheduling/infrastructure/crypto/idempotency-cipher.adapter.js';

describe('idempotency response cipher', () => {
  const cipher = new AesGcmIdempotencyCipher(Buffer.alloc(32, 7));
  it('round-trips private response bytes with associated data', () => {
    const payload = Buffer.from('{"phone":"+5511999999999"}');
    const encrypted = cipher.encrypt(payload, Buffer.from('tenant:actor:operation'));
    expect(Buffer.from(cipher.decrypt(encrypted, Buffer.from('tenant:actor:operation')))).toEqual(payload);
    expect(encrypted).not.toContain(payload);
  });
  it('rejects altered ciphertext and a mismatched scope', () => {
    const encrypted = Buffer.from(cipher.encrypt(Buffer.from('private'), Buffer.from('scope-a')));
    expect(() => cipher.decrypt(encrypted, Buffer.from('scope-b'))).toThrow();
    const lastIndex = encrypted.length - 1;
    encrypted[lastIndex] = (encrypted[lastIndex] ?? 0) ^ 1;
    expect(() => cipher.decrypt(encrypted, Buffer.from('scope-a'))).toThrow();
  });
  it('requires a 32-byte key', () => expect(() => new AesGcmIdempotencyCipher(Buffer.alloc(31))).toThrow());
});
