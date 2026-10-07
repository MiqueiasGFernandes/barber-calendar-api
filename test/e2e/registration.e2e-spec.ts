import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { StartRegistrationUseCase } from '../../src/modules/authentication/application/use-cases/start-registration.use-case.js';
import { VerifyRegistrationOtpUseCase } from '../../src/modules/authentication/application/use-cases/verify-registration-otp.use-case.js';
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
} from './support.js';
const enabled = Boolean(process.env.DATABASE_URL);
describe.runIf(enabled)('registration journey', () => {
  beforeEach(resetDatabase);
  const start = () =>
    new StartRegistrationUseCase(tx, repository, otp, outbox, throttle, clock, 'mailpit');
  const verify = () =>
    new VerifyRegistrationOtpUseCase(
      tx,
      repository,
      otp,
      { issue: async () => 'signed.jwt' },
      clock,
      86400,
    );
  it('keeps state provisional then commits tenant identity and session atomically', async () => {
    const initiated = await start().execute({
      tenantName: 'Barbearia Teste',
      tenantSlug: 'barbearia-teste',
      administratorEmail: 'Owner@Example.test',
      ip: '203.0.113.1',
      correlationId: '10000000-0000-4000-8000-000000000001',
    });
    const provisional = await pool.query(
      `SELECT (SELECT count(*) FROM identity.registration_attempts)::int attempts,(SELECT count(*) FROM identity.otp_challenges)::int challenges,(SELECT count(*) FROM identity.email_outbox)::int outbox,(SELECT count(*) FROM tenancy.tenants)::int tenants,(SELECT count(*) FROM identity.user_accounts)::int users`,
    );
    expect(provisional.rows[0]).toEqual({
      attempts: 1,
      challenges: 1,
      outbox: 1,
      tenants: 0,
      users: 0,
    });
    const useCase = verify();
    const result = await useCase.execute({
      challengeId: initiated.challengeId,
      code: '123456',
      correlationId: '10000000-0000-4000-8000-000000000002',
    });
    expect(result).toEqual({ accessToken: 'signed.jwt', tokenType: 'Bearer', expiresIn: 86400 });
    const final = await pool.query(
      `SELECT (SELECT count(*) FROM tenancy.tenants)::int tenants,(SELECT count(*) FROM identity.user_accounts)::int users,(SELECT count(*) FROM tenancy.tenant_memberships)::int memberships,(SELECT count(*) FROM identity.authenticated_sessions)::int sessions`,
    );
    expect(final.rows[0]).toEqual({ tenants: 1, users: 1, memberships: 1, sessions: 1 });
    await expect(
      useCase.execute({
        challengeId: initiated.challengeId,
        code: '123456',
        correlationId: '10000000-0000-4000-8000-000000000003',
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('persists five failures and locks the challenge', async () => {
    const initiated = await start().execute({
      tenantName: 'Falhas',
      tenantSlug: 'falhas-shop',
      administratorEmail: 'failures@example.test',
      ip: '203.0.113.20',
      correlationId: randomUUID(),
    });
    const useCase = verify();
    for (let index = 0; index < 5; index++)
      await expect(
        useCase.execute({
          challengeId: initiated.challengeId,
          code: '000000',
          correlationId: randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 401 });
    const challenge = await pool.query<{ status: string; failed_attempts: number }>(
      `SELECT status,failed_attempts FROM identity.otp_challenges WHERE id=$1`,
      [initiated.challengeId],
    );
    expect(challenge.rows[0]).toEqual({ status: 'locked', failed_attempts: 5 });
  });
  it('allows exactly one of 100 concurrent confirmations', async () => {
    const initiated = await start().execute({
      tenantName: 'Concorrência',
      tenantSlug: 'concurrency-shop',
      administratorEmail: 'concurrency@example.test',
      ip: '203.0.113.21',
      correlationId: randomUUID(),
    });
    const useCase = verify();
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () =>
        useCase.execute({
          challengeId: initiated.challengeId,
          code: '123456',
          correlationId: randomUUID(),
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const final = await pool.query<{ tenants: number; sessions: number }>(
      `SELECT (SELECT count(*) FROM tenancy.tenants)::int tenants,(SELECT count(*) FROM identity.authenticated_sessions)::int sessions`,
    );
    expect(final.rows[0]).toEqual({ tenants: 1, sessions: 1 });
  });
  afterAll(closeDatabase);
});
