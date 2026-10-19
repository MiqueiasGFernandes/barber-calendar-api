import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { adminPool, pool, resetDatabase, closeDatabase } from '../../e2e/support.js';
import { seedSchedulingFixture } from '../../e2e/scheduling-support.js';
import { auth, configuration, events, key, ids } from './configuration-audit-test-support.js';
describe.runIf(Boolean(process.env.DATABASE_URL))('schema de auditoria administrativa', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedSchedulingFixture(pool);
  });
  afterAll(closeDatabase);
  it('preserva autoria, índices e trilha imutável sem SELECT do runtime', async () => {
    await configuration().updateSettings(auth, key(), {
      slot_interval_minutes: 20,
      minimum_advance_minutes: 0,
    });
    const [event] = await events();
    expect(event).toMatchObject({
      tenant_id: ids.tenantA,
      actor_membership_id: ids.administrator,
      resource_type: 'tenant_settings',
      resource_id: ids.tenantA,
    });
    expect(event.changes).toMatchObject({ slot_interval_minutes: { before: 15, after: 20 } });
    for (const sql of [
      'SELECT *',
      'UPDATE scheduling.configuration_events SET operation=operation',
      'DELETE FROM scheduling.configuration_events',
      'TRUNCATE scheduling.configuration_events',
    ]) {
      await expect(
        pool.query(sql === 'SELECT *' ? `${sql} FROM scheduling.configuration_events` : sql),
      ).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      adminPool.query('UPDATE scheduling.configuration_events SET operation=operation'),
    ).rejects.toThrow('append-only');
    const indexes = await adminPool.query(
      "SELECT indexdef FROM pg_indexes WHERE tablename='configuration_events'",
    );
    expect(indexes.rows).toHaveLength(4);
    for (const change of [
      "tenant_id='10000000-0000-4000-8000-000000000002'",
      "changes='{}'::jsonb",
      "resource_type='invalid'",
      'actor_membership_id=NULL',
    ]) {
      const result = await adminPool.query(
        `SELECT * FROM scheduling.configuration_events WHERE id=$1`,
        [event.id],
      );
      const row = result.rows[0];
      await expect(
        adminPool.query(
          `INSERT INTO scheduling.configuration_events SELECT gen_random_uuid(), ${change.startsWith('tenant_id') ? change.split('=')[1] : 'tenant_id'}, ${change.startsWith('actor_') ? 'NULL' : 'actor_membership_id'},gen_random_uuid(),operation,${change.startsWith('resource_type') ? "'invalid'" : 'resource_type'},resource_id,occurred_at,correlation_id,${change.startsWith('changes') ? "'{}'::jsonb" : 'changes'} FROM scheduling.configuration_events WHERE id=$1`,
          [row.id],
        ),
      ).rejects.toThrow();
    }
    await expect(
      adminPool.query(
        'INSERT INTO scheduling.configuration_events SELECT gen_random_uuid(),tenant_id,actor_membership_id,operation_id,operation,resource_type,resource_id,occurred_at,correlation_id,changes FROM scheduling.configuration_events',
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
