import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase, resetDatabase } from '../../e2e/support.js';
import { PublicThrottleRepository } from '../../../src/modules/scheduling/infrastructure/persistence/public-throttle.repository.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('public scheduling throttle', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const key = 'scheduling-throttle-integration-key'.padEnd(32, 'x');
  const repository = new PublicThrottleRepository(pool, key);
  const now = new Date('2030-01-07T12:00:00Z');
  let tenantId = '';

  beforeEach(async () => {
    await resetDatabase();
    tenantId = randomUUID();
    await pool.query("INSERT INTO tenancy.tenants(id,name,slug,created_at,updated_at) VALUES($1,'Throttle','throttle-test',now(),now())", [tenantId]);
    await pool.query('INSERT INTO scheduling.tenant_settings(tenant_id) VALUES($1)', [tenantId]);
  });

  it('enforces separate read and booking quotas, returns retry delay, expires two-minute counters, and stores only HMAC IPs', async () => {
    const readDecisions = await Promise.all(Array.from({ length: 121 }, () => repository.consume(tenantId, '198.51.100.23', 'read', now)));
    expect(readDecisions.filter(({ allowed }) => allowed)).toHaveLength(120);
    expect(readDecisions.filter(({ allowed }) => !allowed)[0]?.retryAfterSeconds).toBe(60);
    const bookingDecisions = await Promise.all(Array.from({ length: 11 }, () => repository.consume(tenantId, '198.51.100.23', 'booking', now)));
    expect(bookingDecisions.filter(({ allowed }) => allowed)).toHaveLength(10);
    expect(bookingDecisions.filter(({ allowed }) => !allowed)).toHaveLength(1);
    const stored = await pool.query<{ ip_hash: Buffer }>('SELECT ip_hash FROM scheduling.public_throttle_windows WHERE tenant_id=$1 LIMIT 1', [tenantId]);
    expect(stored.rows[0]?.ip_hash).toHaveLength(32);
    expect(stored.rows[0]?.ip_hash.includes(Buffer.from('198.51.100.23'))).toBe(false);
    const nextWindow = await repository.consume(tenantId, '198.51.100.23', 'read', new Date(now.getTime() + 120_001));
    expect(nextWindow.allowed).toBe(true);
    const count = await pool.query<{ count: number }>('SELECT count(*)::int count FROM scheduling.public_throttle_windows WHERE tenant_id=$1', [tenantId]);
    expect(count.rows[0]?.count).toBe(1);
  });

  afterAll(async () => {
    await Promise.all([pool.end(), closeDatabase()]);
  });
});
