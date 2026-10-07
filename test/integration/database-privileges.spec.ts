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
  afterAll(() => pool.end());
});
