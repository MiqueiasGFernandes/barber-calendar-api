import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { OtpDigest } from '../../../../shared/application/ports/otp-generator.js';
import type { TokenIssuer } from '../../../../shared/application/ports/token.js';
import type { TransactionRunner } from '../../../../shared/database/transaction-runner.js';
import { ApplicationError } from '../../../../shared/http/application-error.js';
import type { RegistrationRepository } from '../../infrastructure/persistence/registration.repository.js';

export class VerifyRegistrationOtpUseCase {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repository: RegistrationRepository,
    private readonly digest: OtpDigest,
    private readonly tokens: TokenIssuer,
    private readonly clock: Clock,
    private readonly sessionTtlSeconds: number,
  ) {}
  async execute(input: {
    challengeId: string;
    code: string;
    correlationId: string;
  }): Promise<{ accessToken: string; tokenType: 'Bearer'; expiresIn: number }> {
    if (!/^\d{6}$/.test(input.code))
      throw new ApplicationError(422, 'validation_failed', 'Invalid verification data');
    const now = this.clock.now(),
      expiresAt = new Date(now.getTime() + this.sessionTtlSeconds * 1000),
      ids = {
        tenantId: randomUUID(),
        userId: randomUUID(),
        membershipId: randomUUID(),
        sessionId: randomUUID(),
        jti: randomUUID(),
        eventId: randomUUID(),
        correlationId: input.correlationId,
      };
    try {
      const verified = await this.tx.run(async (client) => {
        const challenge = await this.repository.lockChallenge(client, input.challengeId);
        if (
          !challenge ||
          challenge.purpose !== 'registration' ||
          challenge.status !== 'pending' ||
          now >= challenge.expiresAt ||
          !this.digest.matches(challenge.id, challenge.purpose, input.code, challenge.codeDigest)
        ) {
          if (challenge && challenge.status === 'pending' && now < challenge.expiresAt)
            await this.repository.recordFailure(client, challenge, now);
          return false;
        }
        await this.repository.completeRegistration(client, challenge, now, ids, expiresAt);
        return true;
      });
      if (!verified) throw new ApplicationError(401, 'invalid_otp', 'Verification failed');
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if ((error as { code?: string }).code === '23505')
        throw new ApplicationError(
          409,
          'registration_conflict',
          'Registration identifiers unavailable',
        );
      throw error;
    }
    const accessToken = await this.tokens.issue({
      sub: ids.userId,
      sid: ids.sessionId,
      jti: ids.jti,
      tenantId: ids.tenantId,
      membershipId: ids.membershipId,
      role: 'administrator',
      issuedAt: now,
      expiresAt,
    });
    return { accessToken, tokenType: 'Bearer', expiresIn: this.sessionTtlSeconds };
  }
}
