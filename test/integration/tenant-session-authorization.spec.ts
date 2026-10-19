import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TenantRepository } from '../../src/modules/tenancy/infrastructure/persistence/tenant.repository.js';
import { closeDatabase, clock, database, pool, resetDatabase } from '../e2e/support.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('tenant session authorization', () => {
  beforeEach(resetDatabase);
  it('revalidates session expiry and active account, tenant and membership state', async () => {
    const tenantId = randomUUID(),
      userId = randomUUID(),
      membershipId = randomUUID();
    const sessionId = randomUUID(),
      now = clock.now();
    await pool.query(
      `INSERT INTO tenancy.tenants(id,name,slug,status,created_at,updated_at) VALUES($1,'Authorization','authorization-shop','active',$2,$2)`,
      [tenantId, now],
    );
    await pool.query(
      `INSERT INTO identity.user_accounts(id,email,normalized_email,email_verified_at,status,created_at,updated_at) VALUES($1,'auth@example.test','auth@example.test',$2,'active',$2,$2)`,
      [userId, now],
    );
    await pool.query(
      `INSERT INTO tenancy.tenant_memberships(id,tenant_id,user_id,role,status,created_at,updated_at) VALUES($1,$2,$3,'member','active',$4,$4)`,
      [membershipId, tenantId, userId, now],
    );
    await pool.query(
      `INSERT INTO identity.authenticated_sessions(id,jti,user_id,tenant_id,membership_id,role,issued_at,expires_at,status,created_at) VALUES($1,$2,$3,$4,$5,'member',$6,$7,'active',$6)`,
      [
        sessionId,
        randomUUID(),
        userId,
        tenantId,
        membershipId,
        now,
        new Date(now.getTime() + 60_000),
      ],
    );
    const authorizer = new TenantRepository(database);
    expect(await authorizer.authorizeSession(sessionId, tenantId)).not.toBeNull();
    expect(await authorizer.authorizeSession(sessionId, randomUUID())).toBeNull();
    await pool.query(`UPDATE tenancy.tenant_memberships SET status='inactive' WHERE id=$1`, [
      membershipId,
    ]);
    expect(await authorizer.authorizeSession(sessionId, tenantId)).toBeNull();
    await pool.query(`UPDATE tenancy.tenant_memberships SET status='active' WHERE id=$1`, [
      membershipId,
    ]);
    await pool.query(`UPDATE identity.user_accounts SET status='suspended' WHERE id=$1`, [userId]);
    expect(await authorizer.authorizeSession(sessionId, tenantId)).toBeNull();
    await pool.query(`UPDATE identity.user_accounts SET status='active' WHERE id=$1`, [userId]);
    await pool.query(`UPDATE tenancy.tenants SET status='suspended' WHERE id=$1`, [tenantId]);
    expect(await authorizer.authorizeSession(sessionId, tenantId)).toBeNull();
  });
  afterAll(closeDatabase);
});
