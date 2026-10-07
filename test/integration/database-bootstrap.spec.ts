import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
const enabled = Boolean(process.env.DATABASE_URL);
describe.runIf(enabled)('database bootstrap', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  it('materializes the supported schema revision and all canonical relations', async () => {
    const revision = await pool.query(`SELECT revision FROM app_meta.schema_build WHERE singleton`);
    expect(revision.rows[0]?.revision).toBe('001-tenant-authentication-v3');
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
    ]) {
      const result = await pool.query('SELECT to_regclass($1) AS name', [relation]);
      expect(result.rows[0]?.name).toBe(relation);
    }
  });
  it('bootstrap explicitly orders every canonical script', () => {
    const source = readFileSync('database/init/00-bootstrap.sql', 'utf8');
    const positions = [
      '001_extensions.sql',
      '010_schemas.sql',
      '020_tables.sql',
      '030_constraints.sql',
      '040_indexes.sql',
      '090_schema_manifest.sql',
      '090_grants.sql',
    ].map((name) => source.indexOf(name));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
  afterAll(() => pool.end());
});
