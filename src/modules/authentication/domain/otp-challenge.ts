export type OtpPurpose = 'registration' | 'login';
export type OtpStatus = 'pending' | 'consumed' | 'superseded' | 'locked' | 'expired';
export class OtpChallenge {
  constructor(
    readonly id: string,
    readonly purpose: OtpPurpose,
    readonly expiresAt: Date,
    private state: OtpStatus = 'pending',
    private failures = 0,
  ) {}
  get status(): OtpStatus {
    return this.state;
  }
  get failedAttempts(): number {
    return this.failures;
  }
  fail(now: Date): void {
    this.ensurePending(now);
    this.failures += 1;
    if (this.failures >= 5) this.state = 'locked';
  }
  consume(now: Date): void {
    this.ensurePending(now);
    this.state = 'consumed';
  }
  supersede(): void {
    if (this.state === 'pending') this.state = 'superseded';
  }
  private ensurePending(now: Date): void {
    if (now >= this.expiresAt) this.state = 'expired';
    if (this.state !== 'pending') throw new Error('OTP challenge is not usable');
  }
}
