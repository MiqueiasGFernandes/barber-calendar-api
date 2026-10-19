import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

describe.runIf(Boolean(process.env.DATABASE_URL))('scheduling schema', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  it('applies tenant settings defaults and rejects overlapping confirmed appointments', async () => {
    const client = await pool.connect();
    const tenantId = randomUUID(); const serviceId = randomUUID(); const professionalId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO tenancy.tenants(id,name,slug,created_at,updated_at) VALUES($1,'Schema Test',$2,now(),now())`, [tenantId, `schema-${tenantId}`]);
      await client.query('INSERT INTO scheduling.tenant_settings(tenant_id) VALUES($1)', [tenantId]);
      const defaults = await client.query('SELECT slot_interval_minutes,minimum_advance_minutes FROM scheduling.tenant_settings WHERE tenant_id=$1', [tenantId]);
      expect(defaults.rows[0]).toEqual({ slot_interval_minutes: 15, minimum_advance_minutes: 30 });
      await client.query(`INSERT INTO scheduling.services(id,tenant_id,name,duration_minutes,price_minor,created_at,updated_at) VALUES($1,$2,'Corte',30,5000,now(),now())`, [serviceId, tenantId]);
      await client.query(`INSERT INTO scheduling.professionals(id,tenant_id,name,created_at,updated_at) VALUES($1,$2,'Profissional',now(),now())`, [professionalId, tenantId]);
      const appointmentId = randomUUID();
      await client.query(`INSERT INTO scheduling.appointments(id,public_id,tenant_id,professional_id,service_id,starts_at,ends_at,customer_name,customer_phone,customer_email,service_name_snapshot,duration_minutes_snapshot,price_minor_snapshot,currency_snapshot,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,'2030-01-02T10:00:00Z','2030-01-02T10:30:00Z','Cliente','+5511999999999','client@example.test','Corte',30,5000,'BRL',now(),now())`, [appointmentId, randomUUID(), tenantId, professionalId, serviceId]);
      await client.query('SAVEPOINT overlap');
      await expect(client.query(`INSERT INTO scheduling.appointments(id,public_id,tenant_id,professional_id,service_id,starts_at,ends_at,customer_name,customer_phone,customer_email,service_name_snapshot,duration_minutes_snapshot,price_minor_snapshot,currency_snapshot,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,'2030-01-02T10:29:00Z','2030-01-02T11:00:00Z','Cliente','+5511999999999','client@example.test','Corte',30,5000,'BRL',now(),now())`, [randomUUID(), randomUUID(), tenantId, professionalId, serviceId])).rejects.toMatchObject({ code: '23P01' });
      await client.query('ROLLBACK TO SAVEPOINT overlap');
      await client.query(`INSERT INTO scheduling.appointments(id,public_id,tenant_id,professional_id,service_id,starts_at,ends_at,customer_name,customer_phone,customer_email,service_name_snapshot,duration_minutes_snapshot,price_minor_snapshot,currency_snapshot,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,'2030-01-02T10:30:00Z','2030-01-02T11:00:00Z','Cliente','+5511999999999','client@example.test','Corte',30,5000,'BRL',now(),now())`, [randomUUID(), randomUUID(), tenantId, professionalId, serviceId]);
      const otherTenant = randomUUID();
      await client.query(`INSERT INTO tenancy.tenants(id,name,slug,created_at,updated_at) VALUES($1,'Outro Tenant',$2,now(),now())`, [otherTenant, `schema-${otherTenant}`]);
      await client.query('SAVEPOINT tenant_fk');
      await expect(client.query('INSERT INTO scheduling.professional_services(tenant_id,professional_id,service_id,created_at) VALUES($1,$2,$3,now())', [otherTenant, professionalId, serviceId])).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK TO SAVEPOINT tenant_fk');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
  it('rejects updates to appointment events at the database layer', async () => {
    const result = await pool.query(`SELECT has_table_privilege(current_user,'scheduling.appointment_events','UPDATE') AS can_update,
      has_table_privilege(current_user,'scheduling.appointment_events','DELETE') AS can_delete`);
    expect(result.rows[0]).toEqual({ can_update: false, can_delete: false });
  });
  afterAll(() => pool.end());
});
