import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminPool, pool, resetDatabase, closeDatabase } from '../../e2e/support.js';
import { seedSchedulingFixture } from '../../e2e/scheduling-support.js';
import { auth, configuration, key, ids } from './configuration-audit-test-support.js';
describe.runIf(Boolean(process.env.DATABASE_URL))('consulta interna com RLS', () => {
  const name = `audit_test_${randomUUID().replaceAll('-', '')}`;
  let reader: Pool;
  let readerPassword: string;
  beforeAll(async () => {
    const password = randomUUID();
    readerPassword = password;
    const sql = await adminPool.query<{ sql: string }>(
      "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEROLE INHERIT', $1::text,$2::text) sql",
      [name, password],
    );
    if (!sql.rows[0]) throw new Error('Missing role statement');
    await adminPool.query(sql.rows[0].sql);
    await adminPool.query(`GRANT barber_audit_reader TO ${name}`);
    const url = new URL(process.env.DATABASE_URL ?? '');
    url.username = name;
    url.password = password;
    reader = new Pool({ connectionString: url.toString() });
  });
  beforeEach(async () => {
    await resetDatabase();
    await seedSchedulingFixture(pool);
    await configuration().updateSettings(auth, key(), {
      slot_interval_minutes: 20,
      minimum_advance_minutes: 0,
    });
  });
  afterAll(async () => {
    await reader?.end();
    await adminPool.query(
      'DELETE FROM scheduling.configuration_audit_access WHERE principal_name=$1',
      [name],
    );
    await adminPool.query(`DROP ROLE IF EXISTS ${name}`);
    await closeDatabase();
  });
  it('não confia no filtro nem variável de tenant; expiração/revogação negam novas consultas', async () => {
    expect((await reader.query('SELECT * FROM scheduling.configuration_events')).rows).toHaveLength(
      0,
    );
    await adminPool.query(
      "INSERT INTO scheduling.configuration_audit_access VALUES($1,$2,now(),now()+interval '1 hour','test-owner','support')",
      [name, ids.tenantA],
    );
    expect((await reader.query('SELECT * FROM scheduling.configuration_events')).rows).toHaveLength(
      1,
    );
    await adminPool.query(
      "INSERT INTO scheduling.configuration_audit_access VALUES('other-reader',$1,now(),now()+interval '1 hour','test-owner','support')",
      [ids.tenantB],
    );
    expect(
      (await reader.query('SELECT principal_name FROM scheduling.configuration_audit_access')).rows,
    ).toEqual([{ principal_name: name }]);
    expect(
      (
        await reader.query('SELECT * FROM scheduling.configuration_events WHERE tenant_id=$1', [
          ids.tenantB,
        ])
      ).rows,
    ).toHaveLength(0);
    await reader.query("SELECT set_config('app.tenant_id',$1,false)", [ids.tenantB]);
    expect((await reader.query('SELECT * FROM scheduling.configuration_events')).rows).toHaveLength(
      1,
    );
    await adminPool.query(
      "UPDATE scheduling.configuration_audit_access SET granted_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE principal_name=$1",
      [name],
    );
    expect((await reader.query('SELECT * FROM scheduling.configuration_events')).rows).toHaveLength(
      0,
    );
    await adminPool.query(
      "UPDATE scheduling.configuration_audit_access SET expires_at=now()+interval '1 hour' WHERE principal_name=$1",
      [name],
    );
    await adminPool.query(
      'DELETE FROM scheduling.configuration_audit_access WHERE principal_name=$1',
      [name],
    );
    expect((await reader.query('SELECT * FROM scheduling.configuration_events')).rows).toHaveLength(
      0,
    );
  });
  it('executa a consulta operacional com limites, filtros e cursor seguros', async () => {
    await adminPool.query(
      "INSERT INTO scheduling.configuration_audit_access VALUES($1,$2,now(),now()+interval '1 hour','test-owner','verification')",
      [name, ids.tenantA],
    );
    await configuration().updateSettings(auth, key(), {
      slot_interval_minutes: 30,
      minimum_advance_minutes: 0,
    });
    const url = new URL(process.env.DATABASE_URL ?? '');
    const query = (vars: Record<string, string>) =>
      spawnSync(
        'psql',
        [
          '-X',
          '-tA',
          '-h',
          url.hostname,
          '-p',
          url.port,
          '-U',
          name,
          '-d',
          url.pathname.slice(1),
          ...Object.entries({
            audit_tenant_id: ids.tenantA,
            audit_from: '2030-01-07T00:00Z',
            audit_before: '2030-01-08T00:00Z',
            ...vars,
          }).flatMap(([k, v]) => ['-v', `${k}=${v}`]),
          '-f',
          'database/operations/query-configuration-audit.sql',
        ],
        { env: { ...process.env, PGPASSWORD: readerPassword }, encoding: 'utf8', timeout: 10000 },
      );
    const page = query({ audit_limit: '1' });
    expect(page.status, page.stderr).toBe(0);
    const values = page.stdout.trim().split('|');
    expect(values[1]).toBe(ids.tenantA);
    const next = query({
      audit_limit: '1',
      audit_cursor_at: values[7] ?? '',
      audit_cursor_id: values[0] ?? '',
    });
    expect(next.status, next.stderr).toBe(0);
    expect(next.stdout.trim().split('|')[0]).not.toBe(values[0]);
    expect(query({ audit_resource_type: 'professional' }).stdout.trim()).toBe('');
    expect(query({ audit_tenant_id: ids.tenantB }).stdout.trim()).toBe('');
    expect(query({ audit_limit: '101' }).status).not.toBe(0);
    expect(query({ audit_before: '2029-01-01Z' }).status).not.toBe(0);
    expect(query({ audit_resource_type: "service'; SELECT 1;--" }).status).not.toBe(0);
  });
  it('leitor não pode assumir papéis privilegiados, alterar ACL ou ler clientes', async () => {
    for (const sql of [
      'SET ROLE barber_owner',
      'SET ROLE barber_runtime',
      'DELETE FROM scheduling.configuration_audit_access',
      'TRUNCATE scheduling.configuration_events',
      'SELECT * FROM scheduling.appointments',
      'SELECT * FROM scheduling.idempotency_records',
      'INSERT INTO scheduling.configuration_events DEFAULT VALUES',
    ])
      await expect(reader.query(sql)).rejects.toMatchObject({ code: '42501' });
    const client = await reader.connect();
    try {
      await client.query('SET ROLE barber_audit_reader');
      expect((await client.query('SELECT session_user')).rows[0].session_user).toBe(name);
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  });
});
