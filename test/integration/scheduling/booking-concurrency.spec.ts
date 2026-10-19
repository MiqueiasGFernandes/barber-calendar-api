import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresPool } from '../../../src/shared/database/postgres-pool.js';
import { AesGcmIdempotencyCipher } from '../../../src/modules/scheduling/infrastructure/crypto/idempotency-cipher.adapter.js';
import { AppointmentIdempotencyRepository } from '../../../src/modules/scheduling/infrastructure/persistence/appointment-idempotency.repository.js';
import { AppointmentEventRepository } from '../../../src/modules/scheduling/infrastructure/persistence/appointment-event.repository.js';
import { AppointmentRepository } from '../../../src/modules/scheduling/infrastructure/persistence/appointment.repository.js';
import { AvailabilityRepository } from '../../../src/modules/scheduling/infrastructure/persistence/availability.repository.js';
import { PublicCatalogRepository } from '../../../src/modules/scheduling/infrastructure/persistence/public-catalog.repository.js';
import { SchedulingTransactionAdapter } from '../../../src/modules/scheduling/infrastructure/persistence/scheduling-transaction.adapter.js';
import { IanaTimeZoneAdapter } from '../../../src/modules/scheduling/infrastructure/time/iana-time-zone.adapter.js';
import { CreateGuestAppointmentUseCase } from '../../../src/modules/scheduling/application/use-cases/create-guest-appointment.use-case.js';
import { IdempotentMutationService } from '../../../src/modules/scheduling/application/services/idempotent-mutation.service.js';
import { ApplicationError } from '../../../src/shared/application/application-error.js';
import { closeDatabase, resetDatabase } from '../../e2e/support.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('guest appointment concurrency', () => {
  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString });
  const database = new PostgresPool({ connectionString: connectionString ?? '' });
  const transactions = new SchedulingTransactionAdapter(database);
  const clockState = { value: new Date('2030-01-07T11:00:00Z') };
  const clock = { now: () => new Date(clockState.value) };
  const zones = new IanaTimeZoneAdapter();
  const idempotency = new IdempotentMutationService(transactions, new AppointmentIdempotencyRepository(new AesGcmIdempotencyCipher(Buffer.alloc(32, 4))), clock);
  const events = new AppointmentEventRepository();
  const appointmentRepository = new AppointmentRepository();
  const catalog = new PublicCatalogRepository(database);
  const availability = new AvailabilityRepository(database, zones);
  let tenantId = '';
  let tenantSlug = '';
  let serviceId = '';
  let professionalIds: string[] = [];

  function useCase(eventRepository = events) {
    return new CreateGuestAppointmentUseCase(catalog, availability, zones, idempotency, appointmentRepository, eventRepository);
  }

  async function prepare(professionalCount = 1): Promise<void> {
    await resetDatabase();
    clockState.value = new Date('2030-01-07T11:00:00Z');
    tenantId = randomUUID(); tenantSlug = `booking-${tenantId.slice(0, 8)}`; serviceId = randomUUID();
    await pool.query("INSERT INTO tenancy.tenants(id,name,slug,created_at,updated_at) VALUES($1,'Booking',$2,now(),now())", [tenantId, tenantSlug]);
    await pool.query('INSERT INTO scheduling.tenant_settings(tenant_id) VALUES($1)', [tenantId]);
    await pool.query("INSERT INTO scheduling.services(id,tenant_id,name,duration_minutes,price_minor,currency,status,created_at,updated_at) VALUES($1,$2,'Corte',30,5000,'BRL','active',now(),now())", [serviceId, tenantId]);
    professionalIds = Array.from({ length: professionalCount }, () => randomUUID()).sort();
    for (const id of professionalIds) {
      await pool.query("INSERT INTO scheduling.professionals(id,tenant_id,name,status,created_at,updated_at) VALUES($1,$2,$3,'active',now(),now())", [id, tenantId, `Profissional ${id.slice(0, 4)}`]);
      await pool.query('INSERT INTO scheduling.professional_services(tenant_id,professional_id,service_id,created_at) VALUES($1,$2,$3,now())', [tenantId, id, serviceId]);
      await pool.query("INSERT INTO scheduling.weekly_periods(id,tenant_id,professional_id,iso_weekday,starts_at,ends_at,created_at,updated_at) VALUES($1,$2,$3,1,'09:00','17:00',now(),now())", [randomUUID(), tenantId, id]);
    }
  }

  function request(startsAt: string = '2030-01-07T12:00:00-03:00', key: string = randomUUID(), professionalId?: string) {
    return useCase().execute({ tenantSlug, serviceId, startsAt, guestName: 'Cliente', guestPhone: '+5511999999999', guestEmail: 'client@example.test', idempotencyKey: key, ...(professionalId ? { professionalId } : {}) });
  }

  beforeEach(async () => prepare());

  it('confirma exatamente um de cem pedidos distintos para o mesmo intervalo, emite um evento, e permite bordas adjacentes', async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 100 }, (_, index) => request('2030-01-07T12:00:00-03:00', `booking-key-${String(index).padStart(16, '0')}`)));
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected' && result.reason instanceof ApplicationError && result.reason.status === 409)).toHaveLength(99);
    expect((await pool.query('SELECT count(*)::int count FROM scheduling.appointments WHERE tenant_id=$1', [tenantId])).rows[0]?.count).toBe(1);
    expect((await pool.query("SELECT count(*)::int count FROM scheduling.appointment_events WHERE tenant_id=$1 AND event_type='created'", [tenantId])).rows[0]?.count).toBe(1);
    await expect(request('2030-01-07T12:30:00-03:00')).resolves.toMatchObject({ status: 201, body: { status: 'confirmed' } });
  });

  it('reproduz replay concorrente uma vez, rejeita corpo diferente e persiste junto com evento', async () => {
    const key = `same-key-${randomUUID()}`;
    const replayed = await Promise.all([request(undefined, key), request(undefined, key)]);
    expect(replayed[0]).toEqual(replayed[1]);
    expect((await pool.query('SELECT count(*)::int count FROM scheduling.appointments WHERE tenant_id=$1', [tenantId])).rows[0]?.count).toBe(1);
    await expect(useCase().execute({ tenantSlug, serviceId, startsAt: '2030-01-07T12:30:00-03:00', guestName: 'Cliente', guestPhone: '+5511999999999', guestEmail: 'client@example.test', idempotencyKey: key })).rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' });
  });

  it('reverte reserva e resposta idempotente se a gravação do evento falhar', async () => {
    class FailingEvents extends AppointmentEventRepository {
      override async append(): Promise<void> { throw new Error('event write failed'); }
    }
    await expect(useCase(new FailingEvents()).execute({
      tenantSlug, serviceId, startsAt: '2030-01-07T12:00:00-03:00', guestName: 'Cliente',
      guestPhone: '+5511999999999', guestEmail: 'client@example.test', idempotencyKey: `rollback-${randomUUID()}`,
    })).rejects.toThrow('event write failed');
    expect((await pool.query('SELECT count(*)::int count FROM scheduling.appointments WHERE tenant_id=$1', [tenantId])).rows[0]?.count).toBe(0);
    expect((await pool.query('SELECT count(*)::int count FROM scheduling.idempotency_records WHERE tenant_id=$1', [tenantId])).rows[0]?.count).toBe(0);
  });

  it('escolhe menor carga confirmada no dia e resolve empate pelo UUID', async () => {
    await prepare(2);
    const heavier = professionalIds[1];
    await pool.query(`INSERT INTO scheduling.appointments(id,public_id,tenant_id,professional_id,service_id,starts_at,ends_at,customer_name,customer_phone,customer_email,service_name_snapshot,duration_minutes_snapshot,price_minor_snapshot,currency_snapshot,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,'2030-01-07T16:00:00Z','2030-01-07T17:00:00Z','Cliente','+5511999999999','client@example.test','Corte',60,5000,'BRL',now(),now())`, [randomUUID(), randomUUID(), tenantId, heavier, serviceId]);
    const selected = await request('2030-01-07T12:00:00-03:00');
    expect(selected.body.professional_name).toContain(professionalIds[0]?.slice(0, 4));
  });

  it('captura o relógio somente depois de adquirir o lock por tenant', async () => {
    const locked = new Promise<void>((resolve) => { setLockEntered = resolve; });
    let releaseLock!: () => void;
    const lockHeld = new Promise<void>((resolve) => { releaseLock = resolve; });
    const first = transactions.runForTenant(tenantId, async () => { setLockEntered(); await lockHeld; });
    await locked;
    const attempt = request('2030-01-07T11:30:00-03:00');
    let waiting = false;
    for (let tries = 0; tries < 100; tries++) {
      const result = await pool.query<{ waiting: boolean }>(`SELECT EXISTS(
        SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE 'SELECT tenant_id FROM scheduling.tenant_settings%FOR UPDATE%'
      ) AS waiting`);
      if (result.rows[0]?.waiting) { waiting = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    clockState.value = new Date('2030-01-07T14:00:00.001Z');
    releaseLock();
    await first;
    await expect(attempt).rejects.toMatchObject({ status: 409, code: 'slot_conflict' });
  });

  let setLockEntered: () => void = () => {};
  afterAll(async () => { await Promise.all([pool.end(), database.close(), closeDatabase()]); });
});
