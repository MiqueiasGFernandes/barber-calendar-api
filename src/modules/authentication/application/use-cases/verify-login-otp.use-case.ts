import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../../shared/application/ports/clock.js';
import type { OtpDigest } from '../../../../shared/application/ports/otp-generator.js';
import type { TokenIssuer } from '../../../../shared/application/ports/token.js';
import type { TransactionRunner } from '../../../../shared/database/transaction-runner.js';
import { ApplicationError } from '../../../../shared/http/application-error.js';
import type { OtpThrottleService } from '../services/otp-throttle.service.js';
import type { RegistrationRepository } from '../../infrastructure/persistence/registration.repository.js';

export class VerifyLoginOtpUseCase {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repository: RegistrationRepository,
    private readonly digest: OtpDigest,
    private readonly tokens: TokenIssuer,
    private readonly throttle: OtpThrottleService,
    private readonly clock: Clock,
    private readonly sessionTtlSeconds: number,
  ) {}
  async execute(input: {
    challengeId: string;
    code: string;
    ip: string;
    correlationId: string;
  }): Promise<{ accessToken: string; tokenType: 'Bearer'; expiresIn: number }> {
    if (!/^\d{6}$/.test(input.code))
      throw new ApplicationError(422, 'validation_failed', 'Invalid verification data');
    const now = this.clock.now(),
      expiresAt = new Date(now.getTime() + this.sessionTtlSeconds * 1000),
      ids = {
        sessionId: randomUUID(),
        jti: randomUUID(),
        eventId: randomUUID(),
        correlationId: input.correlationId,
      };
    const identity = await this.tx.run(async (client) => {
      const challenge = await this.repository.lockChallenge(client, input.challengeId);
      if (
        !challenge ||
        challenge.purpose !== 'login' ||
        challenge.status !== 'pending' ||
        now >= challenge.expiresAt
      )
        throw new ApplicationError(401, 'invalid_otp', 'Verification failed');
      if (!this.digest.matches(challenge.id, challenge.purpose, input.code, challenge.codeDigest)) {
        await this.throttle.enforce(client, {
          tenantSlug: challenge.tenantId ?? 'unknown',
          email: challenge.normalizedEmail,
          ip: input.ip,
          action: 'otp_verify_failure',
          now,
        });
        await this.repository.recordFailure(client, challenge, now);
        return null;
      }
      return this.repository.completeLogin(client, challenge, now, ids, expiresAt);
    });
    if (!identity) throw new ApplicationError(401, 'invalid_otp', 'Verification failed');
    const accessToken = await this.tokens.issue({
      sub: identity.userId,
      sid: ids.sessionId,
      jti: ids.jti,
      tenantId: identity.tenantId,
      membershipId: identity.membershipId,
      role: identity.role,
      issuedAt: now,
      expiresAt,
    });
    return { accessToken, tokenType: 'Bearer', expiresIn: this.sessionTtlSeconds };
  }
}
