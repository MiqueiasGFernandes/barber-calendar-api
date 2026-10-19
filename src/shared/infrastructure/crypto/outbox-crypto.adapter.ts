import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type {
  OutboxEnvelope,
  OutboxEnvelopeCipher,
} from '../../application/ports/outbox-envelope.js';

export class OutboxCryptoAdapter implements OutboxEnvelopeCipher {
  constructor(
    private readonly key: Buffer,
    readonly keyVersion = 1,
  ) {
    if (key.length !== 32) throw new Error('AES-256-GCM key must have 32 bytes');
  }
  encrypt(envelope: OutboxEnvelope): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(envelope), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([Buffer.from([this.keyVersion]), nonce, cipher.getAuthTag(), ciphertext]);
  }
  decrypt(payload: Buffer): OutboxEnvelope {
    if (payload[0] !== this.keyVersion || payload.length < 30)
      throw new Error('unsupported or malformed envelope');
    const decipher = createDecipheriv('aes-256-gcm', this.key, payload.subarray(1, 13));
    decipher.setAuthTag(payload.subarray(13, 29));
    return JSON.parse(
      Buffer.concat([decipher.update(payload.subarray(29)), decipher.final()]).toString('utf8'),
    ) as OutboxEnvelope;
  }
}
