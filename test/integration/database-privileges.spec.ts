import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
describe.runIf(Boolean(process.env.DATABASE_URL))('runtime privileges', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  it('allows DML and denies schema/database CREATE', async () => {
    const result = await pool.query(
      `SELECT has_schema_privilege(current_user,'identity','CREATE') AS schema_create,has_database_privilege(current_user,current_database(),'CREATE') AS database_create,has_table_privilege(current_user,'identity.otp_challenges','INSERT') AS dml`,
    );
    expect(result.rows[0]).toEqual({ schema_create: false, database_create: false, dml: true });
  });
  it('allows event inserts while denying mutation of the append-only log', async () => {
    const result = await pool.query(`SELECT has_table_privilege(current_user,'scheduling.appointment_events','INSERT') AS can_insert,
      has_table_privilege(current_user,'scheduling.appointment_events','UPDATE') AS can_update,
      has_table_privilege(current_user,'scheduling.appointment_events','DELETE') AS can_delete,
      has_schema_privilege(current_user,'scheduling','CREATE') AS schema_create`);
    expect(result.rows[0]).toEqual({ can_insert: true, can_update: false, can_delete: false, schema_create: false });
  });
  afterAll(() => pool.end());
});
