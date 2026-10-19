import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { IdempotencyCipher } from '../../application/ports/idempotency-cipher.js';

export class AesGcmIdempotencyCipher implements IdempotencyCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('AES-256-GCM key must have 32 bytes');
  }
  encrypt(plaintext: Uint8Array, associatedData: Uint8Array): Uint8Array {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(associatedData));
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
  }
  decrypt(ciphertext: Uint8Array, associatedData: Uint8Array): Uint8Array {
    const payload = Buffer.from(ciphertext);
    if (payload.length < 28) throw new Error('malformed idempotency ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, payload.subarray(0, 12));
    decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]);
  }
}
