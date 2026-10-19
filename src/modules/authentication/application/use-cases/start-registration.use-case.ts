import { randomUUID } from 'node:crypto';
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

export interface StartRegistrationInput {
  tenantName: string;
  tenantSlug: string;
  administratorEmail: string;
  ip: string;
  correlationId: string;
}
export class StartRegistrationUseCase {
  constructor(
    private readonly tx: TransactionManager,
    private readonly repository: AuthenticationRepository,
    private readonly otp: OtpGenerator & OtpDigest,
    private readonly outbox: OutboxEnvelopeCipher,
    private readonly throttle: OtpThrottleService,
    private readonly clock: Clock,
    private readonly provider: string,
  ) {}
  async execute(input: StartRegistrationInput): Promise<{
    registrationAttemptId: string;
    status: 'verification_required';
    challengeId: string;
    expiresIn: 600;
    resendAfter: 60;
  }> {
    const tenantName = input.tenantName.trim(),
      tenantSlug = input.tenantSlug.trim().toLowerCase(),
      email = input.administratorEmail.trim(),
      normalizedEmail = email.toLowerCase();
    if (
      !tenantName ||
      tenantName.length > 160 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantSlug) ||
      tenantSlug.length < 3 ||
      tenantSlug.length > 80 ||
      !/^\S+@\S+\.\S+$/.test(normalizedEmail)
    )
      throw new ApplicationError(422, 'validation_failed', 'Invalid registration data');
    const now = this.clock.now(),
      attemptId = randomUUID(),
      challengeId = randomUUID(),
      code = this.otp.generate();
    const selected = await this.tx.run(async (client) => {
      await this.throttle.enforce(client, {
        tenantSlug,
        email: normalizedEmail,
        ip: input.ip,
        action: 'otp_issue',
        now,
        correlationId: input.correlationId,
      });
      const recent = await this.repository.findRecentRegistration(
        client,
        tenantSlug,
        normalizedEmail,
        new Date(now.getTime() - 60_000),
      );
      if (recent) return recent;
      await this.repository.supersedeRegistrationChallenges(
        client,
        tenantSlug,
        normalizedEmail,
        now,
      );
      await this.repository.insertProvisional(client, {
        attemptId,
        challengeId,
        outboxId: randomUUID(),
        eventId: randomUUID(),
        correlationId: input.correlationId,
        tenantName,
        tenantSlug,
        email,
        normalizedEmail,
        originDigest: this.throttle.digest(input.ip),
        codeDigest: this.otp.digest(challengeId, 'registration', code),
        keyVersion: 1,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 600_000),
        attemptExpiresAt: new Date(now.getTime() + 600_000),
        envelope: this.outbox.encrypt({
          to: email,
          subject: 'Seu código de acesso',
          text: `Seu código é ${code}`,
        }),
        envelopeKeyVersion: this.outbox.keyVersion,
        provider: this.provider,
      });
      return { attemptId, challengeId };
    });
    return {
      registrationAttemptId: selected.attemptId,
      status: 'verification_required',
      challengeId: selected.challengeId,
      expiresIn: 600,
      resendAfter: 60,
    };
  }
}
