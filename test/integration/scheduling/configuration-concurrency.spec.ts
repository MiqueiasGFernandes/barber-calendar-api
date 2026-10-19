import { ConfigurationAuditService } from '../../../src/modules/scheduling/application/services/configuration-audit.service.js';
import { ConfigurationEventRepository } from '../../../src/modules/scheduling/infrastructure/persistence/configuration-event.repository.js';
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
import { ManageConfigurationUseCases } from '../../../src/modules/scheduling/application/use-cases/manage-configuration.use-cases.js';
import { ConfigurationConflictRepository } from '../../../src/modules/scheduling/infrastructure/persistence/configuration-conflict.repository.js';
import { ConfigurationConflictService } from '../../../src/modules/scheduling/application/services/configuration-conflict.service.js';
import { IdempotentMutationService } from '../../../src/modules/scheduling/application/services/idempotent-mutation.service.js';
import { ApplicationError } from '../../../src/shared/application/application-error.js';
import { adminPool, closeDatabase, resetDatabase } from '../../e2e/support.js';
import { seedSchedulingFixture, schedulingFixtureIds } from '../../e2e/scheduling-support.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('configuration transaction concurrency', () => {
  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString });
  const database = new PostgresPool({ connectionString: connectionString ?? '' });
  const transactions = new SchedulingTransactionAdapter(database);
  const clock = { now: () => new Date('2030-01-07T11:00:00Z') };
  const zones = new IanaTimeZoneAdapter();
  const mutations = new IdempotentMutationService(
    transactions,
    new AppointmentIdempotencyRepository(new AesGcmIdempotencyCipher(Buffer.alloc(32, 9))),
    clock,
  );
  const configuration = new ManageConfigurationUseCases(
    database,
    mutations,
    zones,
    new ConfigurationConflictService(new ConfigurationConflictRepository()),
    new ConfigurationAuditService(
      new ConfigurationEventRepository(),
      new ConfigurationEventRepository(),
    ),
  );
  const auth = {
    tenantId: schedulingFixtureIds.tenantA,
    membershipId: schedulingFixtureIds.administrator,
  };
  const catalog = new PublicCatalogRepository(database);
  const availability = new AvailabilityRepository(database, zones);
  const booking = new CreateGuestAppointmentUseCase(
    catalog,
    availability,
    zones,
    mutations,
    new AppointmentRepository(),
    new AppointmentEventRepository(),
  );
  beforeEach(async () => {
    await resetDatabase();
    await seedSchedulingFixture(pool);
  });
  it('serializes a booking against a new exception: exactly one writer succeeds and rollback preserves the loser', async () => {
    const startsAt = '2030-01-07T13:00:00Z';
    const request = {
      tenantSlug: 'fixture-a',
      serviceId: schedulingFixtureIds.service,
      professionalId: schedulingFixtureIds.professional,
      startsAt: '2030-01-07T10:00:00-03:00',
      guestName: 'Novo Cliente',
      guestPhone: '+5511888888888',
      guestEmail: 'new@example.test',
      idempotencyKey: `booking-${randomUUID()}`,
    };
    const outcomes = await Promise.allSettled([
      booking.execute(request),
      configuration.createException(
        auth,
        `exception-${randomUUID()}`,
        schedulingFixtureIds.professional,
        { kind: 'blocked', starts_at: startsAt, ends_at: '2030-01-07T13:30:00Z' },
      ),
    ]);
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(
      outcomes.filter(
        (x) =>
          x.status === 'rejected' &&
          x.reason instanceof ApplicationError &&
          x.reason.status === 409,
      ),
    ).toHaveLength(1);
    const [appointments, exceptions] = await Promise.all([
      pool.query(
        "SELECT id FROM scheduling.appointments WHERE tenant_id=$1 AND starts_at='2030-01-07T13:00:00Z' AND status='confirmed'",
        [auth.tenantId],
      ),
      pool.query(
        "SELECT id FROM scheduling.availability_exceptions WHERE tenant_id=$1 AND starts_at='2030-01-07T13:00:00Z'",
        [auth.tenantId],
      ),
    ]);
    expect(appointments.rowCount).toBe(outcomes[0]?.status === 'fulfilled' ? 1 : 0);
    expect(exceptions.rowCount).toBe(outcomes[1]?.status === 'fulfilled' ? 1 : 0);
  });
  it('replays administrative writes, preserves appointment snapshots, and allows another tenant to proceed independently', async () => {
    const key = `settings-${randomUUID()}`;
    const first = await configuration.updateSettings(auth, key, {
      slot_interval_minutes: 20,
      minimum_advance_minutes: 0,
    });
    const replay = await configuration.updateSettings(auth, key, {
      slot_interval_minutes: 20,
      minimum_advance_minutes: 0,
    });
    expect(replay).toEqual(first);
    await expect(
      configuration.updateSettings(auth, key, {
        slot_interval_minutes: 30,
        minimum_advance_minutes: 0,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await configuration.updateService(
      auth,
      `service-${randomUUID()}`,
      schedulingFixtureIds.service,
      { duration_minutes: 45, price_minor: 7000 },
    );
    const snapshot = await pool.query<{
      service_name_snapshot: string;
      duration_minutes_snapshot: number;
      price_minor_snapshot: number;
    }>(
      'SELECT service_name_snapshot,duration_minutes_snapshot,price_minor_snapshot FROM scheduling.appointments WHERE id=$1',
      [schedulingFixtureIds.appointment],
    );
    expect(snapshot.rows[0]).toEqual({
      service_name_snapshot: 'Corte de exemplo',
      duration_minutes_snapshot: 30,
      price_minor_snapshot: 5000,
    });
    let release!: () => void;
    let entered!: () => void;
    const locked = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstTenant = transactions.runForTenant(auth.tenantId, async () => {
      entered();
      await hold;
    });
    await locked;
    await expect(
      configuration.updateSettings(
        {
          tenantId: schedulingFixtureIds.tenantB,
          membershipId: schedulingFixtureIds.administratorB,
        },
        `tenant-b-${randomUUID()}`,
        { slot_interval_minutes: 20, minimum_advance_minutes: 0 },
      ),
    ).resolves.toEqual({ slot_interval_minutes: 20, minimum_advance_minutes: 0 });
    release();
    await firstTenant;
  });
  it.each([
    ['em andamento', -15],
    ['no limite de início', 0],
    ['anterior ainda confirmado', -2880],
  ] as const)(
    'protege todo confirmado %s contra mudanças conflitantes',
    async (_label, offsetMinutes) => {
      const dbNow = (await pool.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]
        ?.now;
      if (!dbNow) throw new Error('Clock unavailable');
      const startsAt = new Date(dbNow.getTime() + offsetMinutes * 60000);
      const endsAt = new Date(startsAt.getTime() + 30 * 60000);
      await pool.query('UPDATE scheduling.appointments SET starts_at=$2,ends_at=$3 WHERE id=$1', [
        schedulingFixtureIds.appointment,
        startsAt,
        endsAt,
      ]);
      const conflictingZone = ['Pacific/Kiritimati', 'Pacific/Honolulu', 'Asia/Tokyo', 'UTC'].find(
        (zone) => {
          const local = zones.instantToLocalDateTime(startsAt, zone);
          const end = zones.instantToLocalDateTime(endsAt, zone);
          return (
            new Date(`${local.slice(0, 10)}T00:00Z`).getUTCDay() !== 1 ||
            local.slice(11) < '09:00:00' ||
            end.slice(11) > '17:00:00'
          );
        },
      );
      if (!conflictingZone) throw new Error('Missing conflicting zone fixture');
      const snapshot = async () =>
        (
          await pool.query(
            `SELECT jsonb_build_object(
      'services',(SELECT jsonb_agg(to_jsonb(s)) FROM scheduling.services s),
      'professionals',(SELECT jsonb_agg(to_jsonb(p)) FROM scheduling.professionals p),
      'eligibility',(SELECT jsonb_agg(to_jsonb(e)) FROM scheduling.professional_services e),
      'periods',(SELECT jsonb_agg(to_jsonb(w)) FROM scheduling.weekly_periods w),
      'exceptions',(SELECT jsonb_agg(to_jsonb(x)) FROM scheduling.availability_exceptions x),
      'zone',(SELECT time_zone FROM tenancy.tenants WHERE id=$1),
      'appointments',(SELECT jsonb_agg(to_jsonb(a)) FROM scheduling.appointments a)) snapshot`,
            [auth.tenantId],
          )
        ).rows[0].snapshot;
      const original = await snapshot();
      const block = {
        kind: 'blocked' as const,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      };
      const attempts = [
        () =>
          configuration.updateService(auth, randomUUID(), schedulingFixtureIds.service, {
            status: 'inactive',
          }),
        () =>
          configuration.updateService(auth, randomUUID(), schedulingFixtureIds.service, {
            professional_ids: [],
          }),
        () =>
          configuration.updateProfessional(auth, randomUUID(), schedulingFixtureIds.professional, {
            status: 'inactive',
          }),
        () =>
          configuration.createException(
            auth,
            randomUUID(),
            schedulingFixtureIds.professional,
            block,
          ),
        () =>
          configuration.replacePeriods(auth, randomUUID(), schedulingFixtureIds.professional, []),
        () => configuration.updateTimeZone(auth, randomUUID(), conflictingZone),
      ];
      for (const attempt of attempts) {
        await expect(attempt()).rejects.toMatchObject({
          status: 409,
          conflictingAppointmentIds: [schedulingFixtureIds.appointment],
        });
        expect(await snapshot()).toEqual(original);
      }
      // O runtime não lê a trilha; o contador é conferido na conexão administrativa de testes.
      expect(
        (await adminPool.query('SELECT count(*)::int count FROM scheduling.configuration_events'))
          .rows[0].count,
      ).toBe(0);
      await pool.query("UPDATE scheduling.appointments SET status='cancelled' WHERE id=$1", [
        schedulingFixtureIds.appointment,
      ]);
      await expect(
        configuration.createException(auth, randomUUID(), schedulingFixtureIds.professional, block),
      ).resolves.toHaveProperty('id');
      expect(
        (await adminPool.query('SELECT count(*)::int count FROM scheduling.configuration_events'))
          .rows[0].count,
      ).toBe(1);
    },
  );
  afterAll(async () => {
    await Promise.all([pool.end(), database.close(), closeDatabase()]);
  });
});
