import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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
} from '../e2e/support.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('login session concurrency', () => {
  beforeEach(resetDatabase);
  it('keeps two successful logins as independently authorized sessions', async () => {
    const tenantId = randomUUID(),
      userId = randomUUID(),
      membershipId = randomUUID();
    let now = clock.now();
    const mutableClock = { now: () => new Date(now) };
    await pool.query(
      `INSERT INTO tenancy.tenants(id,name,slug,status,created_at,updated_at) VALUES($1,'Parallel','parallel-shop','active',$2,$2)`,
      [tenantId, now],
    );
    await pool.query(
      `INSERT INTO identity.user_accounts(id,email,normalized_email,email_verified_at,status,created_at,updated_at) VALUES($1,'parallel@example.test','parallel@example.test',$2,'active',$2,$2)`,
      [userId, now],
    );
    await pool.query(
      `INSERT INTO tenancy.tenant_memberships(id,tenant_id,user_id,role,status,created_at,updated_at) VALUES($1,$2,$3,'member','active',$4,$4)`,
      [membershipId, tenantId, userId, now],
    );
    const request = new RequestLoginOtpUseCase(
      tx,
      repository,
      otp,
      outbox,
      throttle,
      mutableClock,
      'mailpit',
    );
    const verify = new VerifyLoginOtpUseCase(
      tx,
      repository,
      otp,
      { issue: async () => randomUUID() },
      throttle,
      mutableClock,
      900,
    );
    const first = await request.execute({
      tenantSlug: 'parallel-shop',
      email: 'parallel@example.test',
      ip: '203.0.113.111',
      correlationId: randomUUID(),
    });
    const firstSession = await verify.execute({
      challengeId: first.challengeId,
      code: '123456',
      ip: '203.0.113.111',
      correlationId: randomUUID(),
    });
    now = new Date(now.getTime() + 60_001);
    const second = await request.execute({
      tenantSlug: 'parallel-shop',
      email: 'parallel@example.test',
      ip: '203.0.113.111',
      correlationId: randomUUID(),
    });
    const secondSession = await verify.execute({
      challengeId: second.challengeId,
      code: '123456',
      ip: '203.0.113.111',
      correlationId: randomUUID(),
    });
    expect(firstSession.expiresIn).toBe(900);
    expect(secondSession.expiresIn).toBe(900);
    const sessions = await pool.query<{ id: string }>(
      `SELECT id FROM identity.authenticated_sessions ORDER BY issued_at`,
    );
    expect(sessions.rows).toHaveLength(2);
    const authorizer = new TenantRepository(database);
    expect(await authorizer.authorizeSession(sessions.rows[0]?.id ?? '', tenantId)).not.toBeNull();
    expect(await authorizer.authorizeSession(sessions.rows[1]?.id ?? '', tenantId)).not.toBeNull();
  });
  afterAll(closeDatabase);
});
