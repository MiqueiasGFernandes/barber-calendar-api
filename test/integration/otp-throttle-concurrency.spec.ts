import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, clock, resetDatabase, throttle, tx } from '../e2e/support.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('throttle concurrency', () => {
  beforeEach(resetDatabase);
  it('serializes 100 simultaneous decisions at the email limit', async () => {
    const decisions = await Promise.allSettled(
      Array.from({ length: 100 }, (_, index) =>
        tx.run((client) =>
          throttle.enforce(client, {
            tenantSlug: `tenant-${index}`,
            email: 'concurrent@example.test',
            ip: `198.18.10.${index}`,
            action: 'otp_issue',
            now: clock.now(),
            correlationId: '10000000-0000-4000-8000-000000000102',
          }),
        ),
      ),
    );
    expect(decisions.filter((decision) => decision.status === 'fulfilled')).toHaveLength(5);
    expect(decisions.filter((decision) => decision.status === 'rejected')).toHaveLength(95);
  });
  afterAll(closeDatabase);
});
