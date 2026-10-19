import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { StartRegistrationUseCase } from '../../src/modules/authentication/application/use-cases/start-registration.use-case.js';
import {
  closeDatabase,
  clock,
  outbox,
  otp,
  pool,
  repository,
  resetDatabase,
  throttle,
  tx,
} from '../e2e/support.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('registration provisional state', () => {
  beforeEach(resetDatabase);
  it('persists only provisional records before OTP verification', async () => {
    const started = await new StartRegistrationUseCase(
      tx,
      repository,
      otp,
      outbox,
      throttle,
      clock,
      'mailpit',
    ).execute({
      tenantName: 'Provisional integration',
      tenantSlug: 'provisional-integration',
      administratorEmail: 'provisional@example.test',
      ip: '203.0.113.101',
      correlationId: '10000000-0000-4000-8000-000000000101',
    });
    const state = await pool.query(
      `SELECT (SELECT count(*) FROM identity.registration_attempts)::int attempts,
        (SELECT count(*) FROM identity.otp_challenges)::int challenges,
        (SELECT count(*) FROM identity.email_outbox)::int outbox,
        (SELECT count(*) FROM audit.security_events)::int events,
        (SELECT count(*) FROM tenancy.tenants)::int tenants,
        (SELECT count(*) FROM identity.user_accounts)::int accounts,
        (SELECT count(*) FROM tenancy.tenant_memberships)::int memberships`,
    );
    expect(state.rows[0]).toEqual({
      attempts: 1,
      challenges: 1,
      outbox: 1,
      events: 1,
      tenants: 0,
      accounts: 0,
      memberships: 0,
    });
    expect(started.status).toBe('verification_required');
  });
  afterAll(closeDatabase);
});
