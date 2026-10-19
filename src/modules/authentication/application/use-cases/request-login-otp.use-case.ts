import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Clock } from '../../../../shared/application/ports/clock.js';
import type {
  OtpDigest,
  OtpGenerator,
} from '../../../../shared/application/ports/otp-generator.js';
import type { TransactionManager } from '../../../../shared/application/ports/transaction.js';
import type { OutboxEnvelopeCipher } from '../../../../shared/application/ports/outbox-envelope.js';
import { ApplicationError } from '../../../../shared/application/application-error.js';
import type { OtpThrottleService } from '../services/otp-throttle.service.js';
import type { AuthenticationRepository } from '../ports/authentication.repository.js';

export class RequestLoginOtpUseCase {
  constructor(
    private readonly tx: TransactionManager,
    private readonly repository: AuthenticationRepository,
    private readonly otp: OtpGenerator & OtpDigest,
    private readonly outbox: OutboxEnvelopeCipher,
    private readonly throttle: OtpThrottleService,
    private readonly clock: Clock,
    private readonly provider: string,
  ) {}
  async execute(input: {
    tenantSlug: string;
    email: string;
    ip: string;
    correlationId: string;
  }): Promise<{ status: 'accepted'; challengeId: string; expiresIn: 600; resendAfter: 60 }> {
    const tenantSlug = input.tenantSlug.trim().toLowerCase(),
      normalizedEmail = input.email.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantSlug) || !/^\S+@\S+\.\S+$/.test(normalizedEmail))
      throw new ApplicationError(422, 'validation_failed', 'Invalid request');
    const now = this.clock.now(),
      publicChallengeId = randomUUID(),
      started = performance.now(),
      code = this.otp.generate(),
      codeDigest = this.otp.digest(publicChallengeId, 'login', code),
      envelope = this.outbox.encrypt({
        to: normalizedEmail,
        subject: 'Seu código de acesso',
        text: `Seu código é ${code}`,
      });
    try {
      await this.tx.run(async (client) => {
        await this.throttle.enforce(client, {
          tenantSlug,
          email: normalizedEmail,
          ip: input.ip,
          action: 'otp_issue',
          now,
          correlationId: input.correlationId,
        });
        const identity = await this.repository.findActiveLoginIdentity(
          client,
          tenantSlug,
          normalizedEmail,
        );
        if (!identity) return; // intentionally indistinguishable public result
        if (
          await this.repository.hasRecentLoginChallenge(
            client,
            identity.userId,
            identity.tenantId,
            new Date(now.getTime() - 60_000),
          )
        )
          return;
        await this.repository.supersedeLoginChallenges(
          client,
          identity.userId,
          identity.tenantId,
          now,
        );
        await this.repository.insertLoginChallenge(client, {
          challengeId: publicChallengeId,
          outboxId: randomUUID(),
          eventId: randomUUID(),
          correlationId: input.correlationId,
          identity,
          normalizedEmail,
          originDigest: this.throttle.digest(input.ip),
          codeDigest,
          keyVersion: 1,
          issuedAt: now,
          expiresAt: new Date(now.getTime() + 600_000),
          envelope,
          envelopeKeyVersion: this.outbox.keyVersion,
          provider: this.provider,
        });
      });
      return {
        status: 'accepted',
        challengeId: publicChallengeId,
        expiresIn: 600,
        resendAfter: 60,
      };
    } finally {
      const remaining = 75 - (performance.now() - started);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }
}
