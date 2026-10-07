export interface OtpGenerator {
  generate(): string;
}
export interface OtpDigest {
  digest(challengeId: string, purpose: string, code: string): Buffer;
  matches(challengeId: string, purpose: string, code: string, digest: Buffer): boolean;
}
