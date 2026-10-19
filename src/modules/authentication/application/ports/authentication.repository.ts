import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';

export interface ActiveLoginIdentity {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: 'administrator' | 'member';
  email: string;
}

export interface LockedChallenge {
  id: string;
  purpose: 'registration' | 'login';
  status: string;
  codeDigest: Buffer;
  keyVersion: number;
  expiresAt: Date;
  failedAttempts: number;
  registrationAttemptId: string | null;
  userId: string | null;
  tenantId: string | null;
  membershipId: string | null;
  normalizedEmail: string;
}

export interface ProvisionalRegistrationInput {
  attemptId: string;
  challengeId: string;
  outboxId: string;
  eventId: string;
  correlationId: string;
  tenantName: string;
  tenantSlug: string;
  email: string;
  normalizedEmail: string;
  originDigest: Buffer;
  codeDigest: Buffer;
  keyVersion: number;
  issuedAt: Date;
  expiresAt: Date;
  attemptExpiresAt: Date;
  envelope: Buffer;
  envelopeKeyVersion: number;
  provider: string;
}

export interface LoginChallengeInput {
  challengeId: string;
  outboxId: string;
  eventId: string;
  correlationId: string;
  identity: ActiveLoginIdentity;
  normalizedEmail: string;
  originDigest: Buffer;
  codeDigest: Buffer;
  keyVersion: number;
  issuedAt: Date;
  expiresAt: Date;
  envelope: Buffer;
  envelopeKeyVersion: number;
  provider: string;
}

export interface RegistrationCompletionIds {
  tenantId: string;
  userId: string;
  membershipId: string;
  sessionId: string;
  jti: string;
  eventId: string;
  correlationId: string;
}

export interface LoginCompletionIds {
  sessionId: string;
  jti: string;
  eventId: string;
  correlationId: string;
}

export interface AuthenticationRepository {
  findRecentRegistration(
    context: TransactionContext,
    tenantSlug: string,
    normalizedEmail: string,
    since: Date,
  ): Promise<{ attemptId: string; challengeId: string } | null>;
  supersedeRegistrationChallenges(
    context: TransactionContext,
    tenantSlug: string,
    normalizedEmail: string,
    now: Date,
  ): Promise<void>;
  insertProvisional(
    context: TransactionContext,
    input: ProvisionalRegistrationInput,
  ): Promise<void>;
  findActiveLoginIdentity(
    context: TransactionContext,
    tenantSlug: string,
    normalizedEmail: string,
  ): Promise<ActiveLoginIdentity | null>;
  hasRecentLoginChallenge(
    context: TransactionContext,
    userId: string,
    tenantId: string,
    since: Date,
  ): Promise<boolean>;
  supersedeLoginChallenges(
    context: TransactionContext,
    userId: string,
    tenantId: string,
    now: Date,
  ): Promise<void>;
  insertLoginChallenge(context: TransactionContext, input: LoginChallengeInput): Promise<void>;
  findChallengePurpose(
    context: TransactionContext,
    id: string,
  ): Promise<'registration' | 'login' | null>;
  lockChallenge(context: TransactionContext, id: string): Promise<LockedChallenge | null>;
  recordFailure(
    context: TransactionContext,
    challenge: LockedChallenge,
    now: Date,
    audit: { eventId: string; correlationId: string },
  ): Promise<void>;
  completeRegistration(
    context: TransactionContext,
    challenge: LockedChallenge,
    now: Date,
    ids: RegistrationCompletionIds,
    expiresAt: Date,
  ): Promise<{ role: 'administrator' }>;
  completeLogin(
    context: TransactionContext,
    challenge: LockedChallenge,
    now: Date,
    ids: LoginCompletionIds,
    expiresAt: Date,
  ): Promise<{
    userId: string;
    tenantId: string;
    membershipId: string;
    role: 'administrator' | 'member';
  }>;
}
