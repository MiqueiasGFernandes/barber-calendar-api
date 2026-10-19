import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { adminPool, pool, resetDatabase, closeDatabase } from '../../e2e/support.js';
import { seedSchedulingFixture } from '../../e2e/scheduling-support.js';
import { ConfigurationEventRepository } from '../../../src/modules/scheduling/infrastructure/persistence/configuration-event.repository.js';
import { auth, configuration, events, key, ids } from './configuration-audit-test-support.js';
describe.runIf(Boolean(process.env.DATABASE_URL))('atomicidade da auditoria', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedSchedulingFixture(pool);
  });
  afterAll(closeDatabase);
  it('replay concorrente e no-op não duplicam; expiração não expurga eventos', async () => {
    const service = configuration(),
      k = key(),
      input = { slot_interval_minutes: 20, minimum_advance_minutes: 0 };
    await Promise.all([
      service.updateSettings(auth, k, input),
      service.updateSettings(auth, k, input),
    ]);
    expect(await events()).toHaveLength(1);
    await service.updateSettings(auth, key(), input);
    expect(await events()).toHaveLength(1);
    await expect(
      service.updateSettings(auth, k, { ...input, slot_interval_minutes: 30 }),
    ).rejects.toMatchObject({ status: 409 });
    await adminPool.query(
      "UPDATE scheduling.idempotency_records SET created_at=created_at-interval '2 days',expires_at=expires_at-interval '2 days'",
    );
    await service.updateSettings(auth, k, { ...input, slot_interval_minutes: 30 });
    expect(await events()).toHaveLength(2);
  });
  it('serializa snapshots anteriores de duas mudanças concorrentes', async () => {
    const service = configuration();
    await Promise.all([
      service.updateSettings(auth, key(), {
        slot_interval_minutes: 20,
        minimum_advance_minutes: 0,
      }),
      service.updateSettings(auth, key(), {
        slot_interval_minutes: 30,
        minimum_advance_minutes: 0,
      }),
    ]);
    const diffs = (await events()).map((e) => e.changes.slot_interval_minutes);
    expect(diffs).toHaveLength(2);
    expect(diffs.filter((d) => d.before === 15)).toHaveLength(1);
    expect(diffs.map((d) => d.after).sort()).toEqual([20, 30]);
    expect(diffs.some((d) => d.before === 20 || d.before === 30)).toBe(true);
  });
  it('reverte configuração, evento e resposta quando append ou save falha', async () => {
    class FailingWriter extends ConfigurationEventRepository {
      override async append() {
        throw new Error('append failed');
      }
    }
    await expect(
      configuration(new FailingWriter()).updateSettings(auth, key(), {
        slot_interval_minutes: 20,
        minimum_advance_minutes: 0,
      }),
    ).rejects.toThrow('append failed');
    await adminPool.query(
      "CREATE FUNCTION scheduling.test_fail_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'save failed'; END $$; CREATE TRIGGER test_fail_save BEFORE INSERT ON scheduling.idempotency_records FOR EACH ROW EXECUTE FUNCTION scheduling.test_fail_save()",
    );
    try {
      await expect(
        configuration().updateSettings(auth, key(), {
          slot_interval_minutes: 20,
          minimum_advance_minutes: 0,
        }),
      ).rejects.toThrow('save failed');
    } finally {
      await adminPool.query(
        'DROP TRIGGER test_fail_save ON scheduling.idempotency_records; DROP FUNCTION scheduling.test_fail_save()',
      );
    }
    expect(await events()).toHaveLength(0);
    expect(
      (
        await pool.query(
          'SELECT slot_interval_minutes FROM scheduling.tenant_settings WHERE tenant_id=$1',
          [ids.tenantA],
        )
      ).rows[0].slot_interval_minutes,
    ).toBe(15);
    expect((await pool.query('SELECT * FROM scheduling.idempotency_records')).rows).toHaveLength(0);
  });
  it('conflito não grava evento e exclusão preserva o recurso removido', async () => {
    const service = configuration();
    await expect(
      service.updateService(auth, key(), ids.service, { status: 'inactive' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await events()).toHaveLength(0);
    const exception = await service.createException(auth, key(), ids.professional, {
      kind: 'blocked',
      starts_at: '2030-01-08T12:00:00Z',
      ends_at: '2030-01-08T13:00:00Z',
    });
    const id = (exception as { id: string }).id;
    await service.deleteException(auth, key(), ids.professional, id);
    await service.deleteException(auth, key(), ids.professional, id);
    const rows = await events();
    expect(rows).toHaveLength(2);
    expect(rows.every((e) => e.resource_id === id)).toBe(true);
    expect(rows.find((e) => e.operation === 'deleteAvailabilityException')?.changes).toMatchObject({
      kind: { before: 'blocked', after: null },
    });
  });
});
