import { createHmac } from 'node:crypto';
import type { Queryable } from '../../../../shared/database/postgres-pool.js';
import { ApplicationError } from '../../../../shared/http/application-error.js';
import type {
  ThrottleAction,
  ThrottleRepository,
} from '../../infrastructure/persistence/throttle.repository.js';

export class OtpThrottleService {
  constructor(
    private readonly repository: ThrottleRepository,
    private readonly key: string,
  ) {}
  async enforce(
    client: Queryable,
    input: { tenantSlug: string; email: string; ip: string; action: ThrottleAction; now: Date },
  ): Promise<void> {
    const failure = input.action === 'otp_verify_failure';
    const subjects = [
      {
        scopeType: 'tenant_email' as const,
        digest: this.digest(`${input.tenantSlug}\0${input.email}`),
        limit: { windowSeconds: failure ? 3600 : 900, maximum: failure ? 10 : 5 },
      },
      {
        scopeType: 'ip' as const,
        digest: this.digest(input.ip),
        limit: { windowSeconds: failure ? 3600 : 900, maximum: failure ? 50 : 20 },
      },
    ];
    const retry = await this.repository.consume(client, subjects, input.action, input.now);
    if (retry !== null)
      throw new ApplicationError(429, 'too_many_requests', 'Try again later', retry);
  }
  digest(value: string): Buffer {
    return createHmac('sha256', this.key).update(value).digest();
  }
}
