import { createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type { SecurityEventWriter } from '../../../../shared/application/ports/security-event-writer.js';
import { ApplicationError } from '../../../../shared/application/application-error.js';
import type { ThrottleAction, ThrottleRepositoryPort } from '../ports/throttle.repository.js';

export class OtpThrottleService {
  constructor(
    private readonly repository: ThrottleRepositoryPort,
    private readonly key: string,
    private readonly securityEvents?: SecurityEventWriter,
  ) {}
  async enforce(
    client: TransactionContext,
    input: {
      tenantSlug: string;
      email: string;
      ip: string;
      action: ThrottleAction;
      now: Date;
      correlationId?: string;
    },
  ): Promise<void> {
    const failure = input.action === 'otp_verify_failure';
    const subjects = [
      {
        scopeType: 'tenant_email' as const,
        digest: this.digest(input.email),
        limit: { windowSeconds: failure ? 3600 : 900, maximum: failure ? 10 : 5 },
      },
      {
        scopeType: 'ip' as const,
        digest: this.digest(input.ip),
        limit: { windowSeconds: failure ? 3600 : 900, maximum: failure ? 50 : 20 },
      },
    ];
    const action: ThrottleAction = failure ? 'otp_verify_failure' : 'otp_issue';
    const retry = await this.repository.consume(client, subjects, action, input.now);
    if (retry !== null) {
      await this.securityEvents?.write({
        id: randomUUID(),
        eventType: 'otp_rate_limited',
        outcome: 'rejected',
        occurredAt: input.now,
        correlationId: input.correlationId ?? randomUUID(),
        reasonCode: action,
      });
      throw new ApplicationError(429, 'too_many_requests', 'Try again later', retry);
    }
  }
  digest(value: string): Buffer {
    return createHmac('sha256', this.key).update(value).digest();
  }
}
