export type RegistrationStatus = 'pending' | 'completed' | 'expired';
export class RegistrationAttempt {
  constructor(
    readonly id: string,
    readonly expiresAt: Date,
    private state: RegistrationStatus = 'pending',
  ) {}
  get status(): RegistrationStatus {
    return this.state;
  }
  complete(now: Date): void {
    if (this.state !== 'pending' || now >= this.expiresAt)
      throw new Error('registration attempt is not completable');
    this.state = 'completed';
  }
  expire(now: Date): void {
    if (this.state !== 'pending' || now < this.expiresAt)
      throw new Error('registration attempt cannot expire');
    this.state = 'expired';
  }
}
