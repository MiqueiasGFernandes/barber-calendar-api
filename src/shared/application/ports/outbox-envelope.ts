export interface OutboxEnvelope {
  to: string;
  subject: string;
  text: string;
}

export interface OutboxEnvelopeCipher {
  readonly keyVersion: number;
  encrypt(envelope: OutboxEnvelope): Buffer;
  decrypt(payload: Buffer): OutboxEnvelope;
}
