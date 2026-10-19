import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresPool } from '../../../src/shared/database/postgres-pool.js';
import { SystemClock } from '../../../src/shared/application/ports/clock.js';
import { ApplicationError } from '../../../src/shared/application/application-error.js';
import { AesGcmIdempotencyCipher } from '../../../src/modules/scheduling/infrastructure/crypto/idempotency-cipher.adapter.js';
import { AppointmentIdempotencyRepository } from '../../../src/modules/scheduling/infrastructure/persistence/appointment-idempotency.repository.js';
import { SchedulingTransactionAdapter } from '../../../src/modules/scheduling/infrastructure/persistence/scheduling-transaction.adapter.js';
import { IdempotentMutationService } from '../../../src/modules/scheduling/application/services/idempotent-mutation.service.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('scheduling mutation protocol', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const database = new PostgresPool({ connectionString: process.env.DATABASE_URL });
  const transactions = new SchedulingTransactionAdapter(database);
  const records = new AppointmentIdempotencyRepository(new AesGcmIdempotencyCipher(Buffer.alloc(32, 6)));
  const service = new IdempotentMutationService(transactions, records, new SystemClock());
  const tenants: string[] = [];
  async function tenant(): Promise<string> {
    const id = randomUUID(); tenants.push(id);
    await pool.query(`INSERT INTO tenancy.tenants(id,name,slug,created_at,updated_at) VALUES($1,'Protocol',$2,now(),now())`, [id, `protocol-${id}`]);
    await pool.query('INSERT INTO scheduling.tenant_settings(tenant_id) VALUES($1)', [id]);
    return id;
  }
  it('serializes mutations by tenant, allows other tenants through, and rolls back failures', async () => {
    const first = await tenant(); const second = await tenant();
    let release!: () => void; let entered!: () => void;
    const enteredLock = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const firstMutation = transactions.runForTenant(first, async () => { entered(); await hold; });
    await enteredLock;
    let sameTenantAcquired = false;
    const secondSame = transactions.runForTenant(first, async () => { sameTenantAcquired = true; });
    let otherTenantAcquired = false;
    await transactions.runForTenant(second, async () => { otherTenantAcquired = true; });
    expect(otherTenantAcquired).toBe(true);
    expect(sameTenantAcquired).toBe(false);
    release(); await Promise.all([firstMutation, secondSame]);
    await expect(transactions.runForTenant(first, async (tx) => {
      await tx.query('UPDATE scheduling.tenant_settings SET slot_interval_minutes=20 WHERE tenant_id=$1', [first]);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    const saved = await pool.query('SELECT slot_interval_minutes FROM scheduling.tenant_settings WHERE tenant_id=$1', [first]);
    expect(saved.rows[0]?.slot_interval_minutes).toBe(15);
  });
  it('replays a concurrent request once, encrypts its response, and rejects a different body', async () => {
    const id = await tenant(); const scope = { tenantId: id, actorScope: 'public', operation: 'create', resourceScope: 'tenant', key: 'key-1234567890123456' };
    let mutations = 0;
    const execute = (request: unknown) => service.execute(id, scope, request, async (...args) => {
      expect(args).toHaveLength(2);
      mutations++;
      const body = { confirmation: 'reservation-token', contact: 'private@example.test' };
      return { result: body, response: { status: 201, headers: { location: '/appointments/x' }, body } };
    });
    const outcomes = await Promise.all([execute({ startsAt: '2030-01-01T10:00:00Z' }), execute({ startsAt: '2030-01-01T10:00:00Z' })]);
    expect(mutations).toBe(1);
    expect(outcomes[0]).toEqual(outcomes[1]);
    const stored = await pool.query<{ response_ciphertext: Buffer }>('SELECT response_ciphertext FROM scheduling.idempotency_records WHERE tenant_id=$1', [id]);
    expect(Buffer.from(stored.rows[0]?.response_ciphertext ?? []).includes(Buffer.from('private@example.test'))).toBe(false);
    await expect(execute({ startsAt: '2030-01-01T11:00:00Z' })).rejects.toBeInstanceOf(ApplicationError);
  });
  it('cleans expired responses under the tenant lock before processing a new command', async () => {
    const id = await tenant(); const scope = { tenantId: id, actorScope: 'public', operation: 'create', resourceScope: 'tenant', key: 'expire-123456789012' };
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await transactions.runForTenant(id, (tx) => records.save(tx, scope, {}, { status: 201, headers: {}, body: { old: true } }, old));
    const result = await service.execute(id, scope, {}, async () => ({ result: 'new', response: { status: 201, headers: {}, body: 'new' } }));
    expect(result).toBe('new');
    const count = await pool.query('SELECT count(*)::int count FROM scheduling.idempotency_records WHERE tenant_id=$1', [id]);
    expect(count.rows[0]?.count).toBe(1);
  });
  afterAll(async () => {
    for (const id of tenants) {
      await pool.query('DELETE FROM scheduling.idempotency_records WHERE tenant_id=$1', [id]);
      await pool.query('DELETE FROM scheduling.tenant_settings WHERE tenant_id=$1', [id]);
      await pool.query('DELETE FROM tenancy.tenants WHERE id=$1', [id]);
    }
    await Promise.all([pool.end(), database.close()]);
  });
});
