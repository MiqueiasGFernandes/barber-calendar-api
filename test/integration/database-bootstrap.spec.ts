import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
const enabled = Boolean(process.env.DATABASE_URL);
describe.runIf(enabled)('database bootstrap', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  it('materializes the supported schema revision and all canonical relations', async () => {
    const revision = await pool.query(`SELECT revision FROM app_meta.schema_build WHERE singleton`);
    expect(revision.rows[0]?.revision).toBe('002-appointment-scheduling-v2');
    for (const relation of [
      'tenancy.tenants',
      'identity.user_accounts',
      'tenancy.tenant_memberships',
      'identity.registration_attempts',
      'identity.otp_challenges',
      'identity.authenticated_sessions',
      'identity.email_outbox',
      'audit.security_events',
      'identity.throttle_subjects',
      'identity.throttle_events',
      'scheduling.tenant_settings',
      'scheduling.services',
      'scheduling.professionals',
      'scheduling.appointments',
      'scheduling.appointment_events',
    ]) {
      const result = await pool.query('SELECT to_regclass($1) AS name', [relation]);
      expect(result.rows[0]?.name).toBe(relation);
    }
  });
  it('starts with DML access and without schema creation privileges', async () => {
    const grants = await pool.query(
      `SELECT has_schema_privilege(current_user,'identity','CREATE') AS schema_create,
        has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
        has_table_privilege(current_user,'identity.otp_challenges','INSERT') AS can_insert`,
    );
    expect(grants.rows[0]).toEqual({
      schema_create: false,
      database_create: false,
      can_insert: true,
    });
  });
  it('grants append-only event access and no DDL to the runtime role', async () => {
    const result = await pool.query(`SELECT has_schema_privilege(current_user,'scheduling','CREATE') AS schema_create,
      has_table_privilege(current_user,'scheduling.appointment_events','INSERT') AS can_insert,
      has_table_privilege(current_user,'scheduling.appointment_events','UPDATE') AS can_update,
      has_table_privilege(current_user,'scheduling.appointment_events','DELETE') AS can_delete`);
    expect(result.rows[0]).toEqual({ schema_create: false, can_insert: true, can_update: false, can_delete: false });
  });
  afterAll(() => pool.end());
});
