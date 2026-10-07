import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { OtpDigest, OtpGenerator } from '../../application/ports/otp-generator.js';

export class CryptoOtpAdapter implements OtpGenerator, OtpDigest {
  constructor(
    private readonly pepper: string,
    readonly keyVersion = 1,
  ) {}
  generate(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }
  digest(challengeId: string, purpose: string, code: string): Buffer {
    return createHmac('sha256', this.pepper)
      .update(`v${String(this.keyVersion)}\0${purpose}\0${challengeId}\0${code}`)
      .digest();
  }
  matches(challengeId: string, purpose: string, code: string, digest: Buffer): boolean {
    const actual = this.digest(challengeId, purpose, code);
    return digest.length === actual.length && timingSafeEqual(digest, actual);
  }
}
