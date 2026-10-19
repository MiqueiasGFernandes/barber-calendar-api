import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { database, pool, resetDatabase, closeDatabase } from '../../e2e/support.js';
import {
  SchedulingTestClock,
  seedSchedulingFixture,
  schedulingFixtureIds as ids,
} from '../../e2e/scheduling-support.js';
import { SchedulingTransactionAdapter } from '../../../src/modules/scheduling/infrastructure/persistence/scheduling-transaction.adapter.js';
import { AppointmentIdempotencyRepository } from '../../../src/modules/scheduling/infrastructure/persistence/appointment-idempotency.repository.js';
import { AesGcmIdempotencyCipher } from '../../../src/modules/scheduling/infrastructure/crypto/idempotency-cipher.adapter.js';
import { IdempotentMutationService } from '../../../src/modules/scheduling/application/services/idempotent-mutation.service.js';
import { AppointmentEventRepository } from '../../../src/modules/scheduling/infrastructure/persistence/appointment-event.repository.js';
import { AppointmentLifecycleRepository } from '../../../src/modules/scheduling/infrastructure/persistence/appointment-lifecycle.repository.js';
import { AppointmentQueryRepository } from '../../../src/modules/scheduling/infrastructure/persistence/appointment-query.repository.js';
import { AppointmentLifecycleService } from '../../../src/modules/scheduling/application/services/appointment-lifecycle.service.js';
import { AvailabilityRepository } from '../../../src/modules/scheduling/infrastructure/persistence/availability.repository.js';
import { IanaTimeZoneAdapter } from '../../../src/modules/scheduling/infrastructure/time/iana-time-zone.adapter.js';
import { PublicCatalogRepository } from '../../../src/modules/scheduling/infrastructure/persistence/public-catalog.repository.js';
import { AppointmentRepository } from '../../../src/modules/scheduling/infrastructure/persistence/appointment.repository.js';
import { CreateGuestAppointmentUseCase } from '../../../src/modules/scheduling/application/use-cases/create-guest-appointment.use-case.js';

const publicId = '80000000-0000-4000-8000-000000000001';
describe.runIf(Boolean(process.env.DATABASE_URL))('appointment lifecycle transactions', () => {
  const clock = new SchedulingTestClock(new Date('2030-01-07T11:00:00Z'));
  const zones = new IanaTimeZoneAdapter();
  const transactions = new SchedulingTransactionAdapter(database);
  const idempotency = new IdempotentMutationService(
    transactions,
    new AppointmentIdempotencyRepository(new AesGcmIdempotencyCipher(Buffer.alloc(32, 6))),
    clock,
  );
  const availability = new AvailabilityRepository(database, zones);
  const queries = new AppointmentQueryRepository(database, zones);
  const makeService = (events = new AppointmentEventRepository()) =>
    new AppointmentLifecycleService(
      idempotency,
      new AppointmentLifecycleRepository(database),
      events,
      availability,
      zones,
    );
  const input = (key = randomUUID()) => ({
    tenantId: ids.tenantA,
    membershipId: ids.administrator,
    appointmentId: publicId,
    idempotencyKey: key,
    correlationId: randomUUID(),
  });
  const book = (startsAt = '2030-01-07T09:00:00-03:00') =>
    new CreateGuestAppointmentUseCase(
      new PublicCatalogRepository(database),
      availability,
      zones,
      idempotency,
      new AppointmentRepository(),
      new AppointmentEventRepository(),
    ).execute({
      tenantSlug: 'fixture-a',
      serviceId: ids.service,
      professionalId: ids.professional,
      startsAt,
      guestName: 'Novo cliente',
      guestPhone: '+5511888888888',
      guestEmail: 'new@example.test',
      idempotencyKey: randomUUID(),
    });
  beforeEach(async () => {
    await resetDatabase();
    await seedSchedulingFixture(pool);
    clock.set(new Date('2030-01-07T11:00:00Z'));
  });

  it('serializes cancellation and a competing booking, releases only after commit and appends one event', async () => {
    const outcomes = await Promise.allSettled([
      makeService().execute(input(), { kind: 'cancel' }),
      book(),
    ]);
    expect(outcomes[0]?.status).toBe('fulfilled');
    if (outcomes[1]?.status === 'rejected') {
      expect(outcomes[1].reason).toMatchObject({ status: 409 });
      await expect(book()).resolves.toMatchObject({ status: 201 });
    }
    const rows = await pool.query(
      "SELECT status FROM scheduling.appointments WHERE tenant_id=$1 AND starts_at='2030-01-07T12:00Z'",
      [ids.tenantA],
    );
    expect(rows.rows.filter((row) => row.status === 'confirmed')).toHaveLength(1);
    expect(
      (
        await pool.query(
          'SELECT event_type,actor_membership_id FROM scheduling.appointment_events WHERE appointment_id=$1',
          [ids.appointment],
        )
      ).rows,
    ).toEqual([{ event_type: 'cancelled', actor_membership_id: ids.administrator }]);
  });
  it('serializes cancellation versus rescheduling and accepts exactly one of two concurrent final outcomes', async () => {
    const commands = [
      { kind: 'cancel' },
      { kind: 'reschedule', startsAt: '2030-01-07T10:00:00-03:00' },
    ] as const;
    const race = await Promise.allSettled(
      commands.map((command) => makeService().execute(input(), command)),
    );
    // A reschedule can precede cancellation; both are valid in that serial order.
    expect(race.filter((x) => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    for (const result of race)
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 409 });
    await resetDatabase();
    await seedSchedulingFixture(pool);
    clock.set(new Date('2030-01-07T13:00:00Z'));
    const finals = await Promise.allSettled(
      ['attended', 'no_show'].map((status) =>
        makeService().execute(input(), {
          kind: 'outcome',
          status: status as 'attended' | 'no_show',
        }),
      ),
    );
    expect(finals.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(finals.filter((x) => x.status === 'rejected')).toHaveLength(1);
    expect(
      (
        await pool.query('SELECT id FROM scheduling.appointment_events WHERE appointment_id=$1', [
          ids.appointment,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it('replays original responses after subsequent state changes without repeating events', async () => {
    const service = makeService();
    const original = input();
    const response = await service.execute(original, {
      kind: 'reschedule',
      startsAt: '2030-01-07T10:00:00-03:00',
    });
    await service.execute(input(), { kind: 'cancel' });
    expect(
      await service.execute(original, {
        kind: 'reschedule',
        startsAt: '2030-01-07T10:00:00-03:00',
      }),
    ).toEqual(response);
    expect(
      await service.execute(
        { ...original, appointmentId: ids.appointment },
        { kind: 'reschedule', startsAt: '2030-01-07T10:00:00-03:00' },
      ),
    ).toEqual(response);
    await expect(
      service.execute(original, { kind: 'reschedule', startsAt: '2030-01-07T10:15:00-03:00' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await pool.query('SELECT id FROM scheduling.appointment_events WHERE appointment_id=$1', [
          ids.appointment,
        ])
      ).rowCount,
    ).toBe(2);
  });
  it('replays concurrent administrative requests once and encrypts the stored contact response', async () => {
    const original = input();
    const response = await Promise.all([
      makeService().execute(original, { kind: 'cancel' }),
      makeService().execute({ ...original, appointmentId: ids.appointment }, { kind: 'cancel' }),
    ]);
    expect(response[0]).toEqual(response[1]);
    expect(
      (
        await pool.query('SELECT id FROM scheduling.appointment_events WHERE appointment_id=$1', [
          ids.appointment,
        ])
      ).rowCount,
    ).toBe(1);
    const records = await pool.query<{ response_ciphertext: Buffer }>(
      'SELECT response_ciphertext FROM scheduling.idempotency_records WHERE tenant_id=$1',
      [ids.tenantA],
    );
    expect(records.rowCount).toBe(1);
    for (const value of ['Cliente Exemplo', 'client@example.test', '+5511999999999'])
      expect(records.rows[0]?.response_ciphertext.includes(Buffer.from(value))).toBe(false);
  });
  it('allows only one of two appointments to move into the same interval and retains the losing original interval', async () => {
    const second = await book('2030-01-07T11:00:00-03:00');
    const otherId = String(second.body.id);
    const requests = [input(), { ...input(), appointmentId: otherId }];
    const outcomes = await Promise.allSettled(
      requests.map((request) =>
        makeService().execute(request, {
          kind: 'reschedule',
          startsAt: '2030-01-07T10:00:00-03:00',
        }),
      ),
    );
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    for (const result of outcomes)
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 409 });
    const rows = await pool.query<{ public_id: string; starts_at: Date }>(
      "SELECT public_id,starts_at FROM scheduling.appointments WHERE tenant_id=$1 AND status='confirmed' ORDER BY starts_at",
      [ids.tenantA],
    );
    expect(
      rows.rows.filter((row) => row.starts_at.toISOString() === '2030-01-07T13:00:00.000Z'),
    ).toHaveLength(1);
    const loser = outcomes[0]?.status === 'rejected' ? publicId : otherId;
    expect(rows.rows.find((row) => row.public_id === loser)?.starts_at.toISOString()).toBe(
      loser === publicId ? '2030-01-07T12:00:00.000Z' : '2030-01-07T14:00:00.000Z',
    );
    expect(
      (
        await pool.query(
          "SELECT id FROM scheduling.appointment_events WHERE event_type='rescheduled'",
        )
      ).rowCount,
    ).toBe(1);
  });
  it('revalidates the clock after waiting for the tenant lock', async () => {
    let entered!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = transactions.runForTenant(ids.tenantA, async () => {
      entered();
      await holding;
    });
    await locked;
    const pending = makeService().execute(input(), {
      kind: 'reschedule',
      startsAt: '2030-01-07T09:30:00-03:00',
    });
    // Attach the rejection handler before releasing the transaction.
    const outcome = expect(pending).rejects.toMatchObject({ status: 409 });
    let waiting = false;
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await pool.query<{ waiting: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT tenant_id FROM scheduling.tenant_settings%FOR UPDATE%') AS waiting`,
        );
        if (result.rows[0]?.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      clock.set(new Date('2030-01-07T12:01:00Z'));
    } finally {
      release();
    }
    await holder;
    await outcome;
    expect(waiting).toBe(true);
    expect(
      (
        await pool.query<{ starts_at: Date }>(
          'SELECT starts_at FROM scheduling.appointments WHERE id=$1',
          [ids.appointment],
        )
      ).rows[0]?.starts_at.toISOString(),
    ).toBe('2030-01-07T12:00:00.000Z');
  });
  it.each([
    '2030-01-07T09:07:00-03:00',
    '2030-01-07T08:15:00-03:00',
    '2030-01-07T16:45:00-03:00',
    '2030-02-07T09:00:00-03:00',
  ])(
    'rejects starts outside the current grid, advance, full duration or booking window: %s',
    async (startsAt) => {
      await expect(
        makeService().execute(input(), { kind: 'reschedule', startsAt }),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (
          await pool.query('SELECT id FROM scheduling.appointment_events WHERE appointment_id=$1', [
            ids.appointment,
          ])
        ).rowCount,
      ).toBe(0);
    },
  );
  it('reschedules across its own old interval using duration snapshots and preserves service and price history', async () => {
    await pool.query(
      'UPDATE scheduling.services SET duration_minutes=60,price_minor=9000,name=$2 WHERE id=$1',
      [ids.service, 'Novo nome'],
    );
    const response = await makeService().execute(input(), {
      kind: 'reschedule',
      startsAt: '2030-01-07T09:15:00-03:00',
    });
    expect(response.body).toMatchObject({
      service_name: 'Corte de exemplo',
      starts_at: '2030-01-07T09:15:00-03:00',
      ends_at: '2030-01-07T09:45:00-03:00',
    });
    const row = await pool.query(
      'SELECT duration_minutes_snapshot,price_minor_snapshot,service_id,professional_id FROM scheduling.appointments WHERE id=$1',
      [ids.appointment],
    );
    expect(row.rows[0]).toEqual({
      duration_minutes_snapshot: 30,
      price_minor_snapshot: 5000,
      service_id: ids.service,
      professional_id: ids.professional,
    });
    const event = await pool.query<{
      previous_starts_at: Date;
      starts_at: Date;
      correlation_id: string;
    }>(
      'SELECT previous_starts_at,starts_at,correlation_id FROM scheduling.appointment_events WHERE appointment_id=$1',
      [ids.appointment],
    );
    expect(event.rows[0]?.previous_starts_at.toISOString()).toBe('2030-01-07T12:00:00.000Z');
    expect(event.rows[0]?.starts_at.toISOString()).toBe('2030-01-07T12:15:00.000Z');
  });
  it('rolls back interval, event and idempotency result on conflict or event persistence failure', async () => {
    await pool.query(
      `INSERT INTO scheduling.availability_exceptions(id,tenant_id,professional_id,kind,starts_at,ends_at,created_by_membership_id,created_at) VALUES($1,$2,$3,'blocked','2030-01-07T13:00Z','2030-01-07T14:00Z',$4,now())`,
      [randomUUID(), ids.tenantA, ids.professional, ids.administrator],
    );
    await expect(
      makeService().execute(input(), { kind: 'reschedule', startsAt: '2030-01-07T10:00:00-03:00' }),
    ).rejects.toMatchObject({ status: 409 });
    class FailedEvents extends AppointmentEventRepository {
      override async append(): Promise<void> {
        throw new Error('simulated event failure');
      }
    }
    await expect(
      makeService(new FailedEvents()).execute(input(), { kind: 'cancel' }),
    ).rejects.toThrow('simulated event failure');
    expect(
      (
        await pool.query('SELECT status,starts_at FROM scheduling.appointments WHERE id=$1', [
          ids.appointment,
        ])
      ).rows[0],
    ).toMatchObject({ status: 'confirmed', starts_at: new Date('2030-01-07T12:00Z') });
    expect((await pool.query('SELECT id FROM scheduling.appointment_events')).rowCount).toBe(0);
    expect((await pool.query('SELECT id FROM scheduling.idempotency_records')).rowCount).toBe(0);
  });
  it('isolates reads, mutations and replays by tenant and never changes final states', async () => {
    const service = makeService();
    const original = input();
    await service.execute(original, { kind: 'cancel' });
    await expect(
      service.execute({ ...original, tenantId: ids.tenantB }, { kind: 'cancel' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await queries.list(ids.tenantB, {
        startsFrom: new Date('2030-01-01Z'),
        endsBefore: new Date('2030-02-01Z'),
      }),
    ).toEqual([]);
    for (const command of [
      { kind: 'cancel' },
      { kind: 'reschedule', startsAt: '2030-01-07T10:00:00-03:00' },
      { kind: 'outcome', status: 'attended' },
    ] as const)
      await expect(service.execute(input(), command)).rejects.toMatchObject({ status: 409 });
  });
  afterAll(closeDatabase);
});
