import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { VerifyRegistrationOtpUseCase } from '../../src/modules/authentication/application/use-cases/verify-registration-otp.use-case.js';
import {
  closeDatabase,
  clock,
  otp,
  pool,
  repository,
  resetDatabase,
  throttle,
  tx,
} from '../e2e/support.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('registration concurrency', () => {
  beforeEach(resetDatabase);
  it('commits one independent attempt when distinct codes compete for one tenant slug', async () => {
    const now = clock.now();
    const attempts = Array.from({ length: 20 }, () => ({
      attempt: randomUUID(),
      challenge: randomUUID(),
      email: `race-${randomUUID()}@example.test`,
    }));
    for (const item of attempts) {
      await pool.query(
        `INSERT INTO identity.registration_attempts(id,tenant_name,tenant_slug,administrator_email,normalized_email,expires_at,created_at) VALUES($1,'Race','integration-race',$2,$2,$3,$4)`,
        [item.attempt, item.email, new Date(now.getTime() + 600_000), now],
      );
      await pool.query(
        `INSERT INTO identity.otp_challenges(id,purpose,registration_attempt_id,normalized_email,origin_digest,code_digest,key_version,issued_at,expires_at) VALUES($1,'registration',$2,$3,$4,$5,1,$6,$7)`,
        [
          item.challenge,
          item.attempt,
          item.email,
          Buffer.alloc(32),
          otp.digest(item.challenge, 'registration', '123456'),
          now,
          new Date(now.getTime() + 600_000),
        ],
      );
    }
    const useCase = new VerifyRegistrationOtpUseCase(
      tx,
      repository,
      otp,
      { issue: async () => 'test-token' },
      throttle,
      clock,
      86_400,
    );
    const outcomes = await Promise.allSettled(
      attempts.map((item) =>
        useCase.execute({
          challengeId: item.challenge,
          code: '123456',
          ip: '203.0.113.105',
          correlationId: randomUUID(),
        }),
      ),
    );
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const definitive = await pool.query(
      `SELECT (SELECT count(*) FROM tenancy.tenants)::int tenants,(SELECT count(*) FROM identity.user_accounts)::int accounts,(SELECT count(*) FROM tenancy.tenant_memberships)::int memberships,(SELECT count(*) FROM identity.authenticated_sessions)::int sessions`,
    );
    expect(definitive.rows[0]).toEqual({ tenants: 1, accounts: 1, memberships: 1, sessions: 1 });
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(19);
  });
  afterAll(closeDatabase);
});
