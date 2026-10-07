import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RequestLoginOtpUseCase } from '../../src/modules/authentication/application/use-cases/request-login-otp.use-case.js';
import { VerifyLoginOtpUseCase } from '../../src/modules/authentication/application/use-cases/verify-login-otp.use-case.js';
import { TenantRepository } from '../../src/modules/tenancy/infrastructure/persistence/tenant.repository.js';
import {
  closeDatabase,
  clock,
  database,
  outbox,
  otp,
  pool,
  repository,
  resetDatabase,
  throttle,
  tx,
} from './support.js';
const enabled = Boolean(process.env.DATABASE_URL);
describe.runIf(enabled)('login OTP journey', () => {
  let tenantId: string, userId: string, membershipId: string;
  beforeEach(async () => {
    await resetDatabase();
    tenantId = randomUUID();
    userId = randomUUID();
    membershipId = randomUUID();
    const now = clock.now();
    await pool.query(
      `INSERT INTO tenancy.tenants(id,name,slug,status,created_at,updated_at) VALUES($1,'Seed','seed-tenant','active',$2,$2)`,
      [tenantId, now],
    );
    await pool.query(
      `INSERT INTO identity.user_accounts(id,email,normalized_email,email_verified_at,status,created_at,updated_at) VALUES($1,'member@example.test','member@example.test',$2,'active',$2,$2)`,
      [userId, now],
    );
    await pool.query(
      `INSERT INTO tenancy.tenant_memberships(id,tenant_id,user_id,role,status,created_at,updated_at) VALUES($1,$2,$3,'member','active',$4,$4)`,
      [membershipId, tenantId, userId, now],
    );
  });
  it('returns equivalent acceptance and only eligible identities receive usable challenges', async () => {
    const request = new RequestLoginOtpUseCase(
      tx,
      repository,
      otp,
      outbox,
      throttle,
      clock,
      'mailpit',
    );
    const known = await request.execute({
      tenantSlug: 'seed-tenant',
      email: 'member@example.test',
      ip: '203.0.113.2',
      correlationId: randomUUID(),
    });
    const unknown = await request.execute({
      tenantSlug: 'seed-tenant',
      email: 'unknown@example.test',
      ip: '203.0.113.3',
      correlationId: randomUUID(),
    });
    expect({ ...known, challengeId: 'opaque' }).toEqual({ ...unknown, challengeId: 'opaque' });
    const count = await pool.query(`SELECT count(*)::int AS count FROM identity.otp_challenges`);
    expect(count.rows[0]?.count).toBe(1);
    const verify = new VerifyLoginOtpUseCase(
      tx,
      repository,
      otp,
      { issue: async () => 'login.jwt' },
      throttle,
      clock,
      900,
    );
    const result = await verify.execute({
      challengeId: known.challengeId,
      code: '123456',
      ip: '203.0.113.2',
      correlationId: randomUUID(),
    });
    expect(result.expiresIn).toBe(900);
    const authorization = new TenantRepository(database);
    expect(
      await authorization.authorizeSession(
        (await pool.query(`SELECT id FROM identity.authenticated_sessions`)).rows[0]?.id as string,
        tenantId,
      ),
    ).not.toBeNull();
    await pool.query(`UPDATE tenancy.tenant_memberships SET status='inactive' WHERE id=$1`, [
      membershipId,
    ]);
    expect(
      await authorization.authorizeSession(
        (await pool.query(`SELECT id FROM identity.authenticated_sessions`)).rows[0]?.id as string,
        tenantId,
      ),
    ).toBeNull();
  });
  it('enforces resend interval, supersedes the old OTP and preserves parallel sessions', async () => {
    let now = clock.now();
    const mutableClock = { now: () => new Date(now) };
    const request = new RequestLoginOtpUseCase(
      tx,
      repository,
      otp,
      outbox,
      throttle,
      mutableClock,
      'mailpit',
    );
    const first = await request.execute({
      tenantSlug: 'seed-tenant',
      email: 'member@example.test',
      ip: '203.0.113.30',
      correlationId: randomUUID(),
    });
    now = new Date(now.getTime() + 59_000);
    await request.execute({
      tenantSlug: 'seed-tenant',
      email: 'member@example.test',
      ip: '203.0.113.30',
      correlationId: randomUUID(),
    });
    expect(
      (await pool.query(`SELECT count(*)::int count FROM identity.otp_challenges`)).rows[0]?.count,
    ).toBe(1);
    now = new Date(now.getTime() + 1_001);
    const second = await request.execute({
      tenantSlug: 'seed-tenant',
      email: 'member@example.test',
      ip: '203.0.113.30',
      correlationId: randomUUID(),
    });
    const statuses = await pool.query<{ id: string; status: string }>(
      `SELECT id,status FROM identity.otp_challenges ORDER BY issued_at`,
    );
    expect(statuses.rows).toEqual([
      { id: first.challengeId, status: 'superseded' },
      { id: second.challengeId, status: 'pending' },
    ]);
    const verify = new VerifyLoginOtpUseCase(
      tx,
      repository,
      otp,
      { issue: async () => 'login.jwt' },
      throttle,
      mutableClock,
      900,
    );
    await expect(
      verify.execute({
        challengeId: first.challengeId,
        code: '123456',
        ip: '203.0.113.30',
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 401 });
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () =>
        verify.execute({
          challengeId: second.challengeId,
          code: '123456',
          ip: '203.0.113.30',
          correlationId: randomUUID(),
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await pool.query(`SELECT count(*)::int count FROM identity.authenticated_sessions`)).rows[0]
        ?.count,
    ).toBe(1);
  });
  afterAll(closeDatabase);
});
