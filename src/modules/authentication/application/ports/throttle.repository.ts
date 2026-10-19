import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';

export type ThrottleAction = 'registration' | 'otp_issue' | 'otp_verify_failure';
export interface ThrottleLimit {
  windowSeconds: number;
  maximum: number;
}
export interface ThrottleSubject {
  scopeType: 'tenant_email' | 'ip';
  digest: Buffer;
  limit: ThrottleLimit;
}
export interface ThrottleRepositoryPort {
  consume(
    context: TransactionContext,
    subjects: readonly ThrottleSubject[],
    action: ThrottleAction,
    now: Date,
  ): Promise<number | null>;
}
