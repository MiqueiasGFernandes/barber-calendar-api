import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../../shared/application/ports/clock.js';
import type {
  OtpDigest,
  OtpGenerator,
} from '../../../../shared/application/ports/otp-generator.js';
import type { TransactionRunner } from '../../../../shared/database/transaction-runner.js';
import type { OutboxCryptoAdapter } from '../../../../shared/infrastructure/crypto/outbox-crypto.adapter.js';
import { ApplicationError } from '../../../../shared/http/application-error.js';
import type { OtpThrottleService } from '../services/otp-throttle.service.js';
import type { RegistrationRepository } from '../../infrastructure/persistence/registration.repository.js';

export class RequestLoginOtpUseCase {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repository: RegistrationRepository,
    private readonly otp: OtpGenerator & OtpDigest,
    private readonly outbox: OutboxCryptoAdapter,
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
      publicChallengeId = randomUUID();
    await this.tx.run(async (client) => {
      await this.throttle.enforce(client, {
        tenantSlug,
        email: normalizedEmail,
        ip: input.ip,
        action: 'otp_issue',
        now,
      });
      const identity = await this.repository.findActiveLoginIdentity(
        client,
        tenantSlug,
        normalizedEmail,
      );
      if (!identity) return; // intentionally indistinguishable public result
      const recent = await client.query(
        `SELECT 1 FROM identity.otp_challenges WHERE user_id=$1 AND tenant_id=$2 AND issued_at>$3 AND status='pending'`,
        [identity.userId, identity.tenantId, new Date(now.getTime() - 60_000)],
      );
      if ((recent.rowCount ?? 0) > 0) return;
      await this.repository.supersedeLoginChallenges(
        client,
        identity.userId,
        identity.tenantId,
        now,
      );
      const code = this.otp.generate();
      await this.repository.insertLoginChallenge(client, {
        challengeId: publicChallengeId,
        outboxId: randomUUID(),
        eventId: randomUUID(),
        correlationId: input.correlationId,
        identity,
        normalizedEmail,
        originDigest: this.throttle.digest(input.ip),
        codeDigest: this.otp.digest(publicChallengeId, 'login', code),
        keyVersion: 1,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 600_000),
        envelope: this.outbox.encrypt({
          to: identity.email,
          subject: 'Seu código de acesso',
          text: `Seu código é ${code}`,
        }),
        envelopeKeyVersion: this.outbox.keyVersion,
        provider: this.provider,
      });
    });
    return { status: 'accepted', challengeId: publicChallengeId, expiresIn: 600, resendAfter: 60 };
  }
}
