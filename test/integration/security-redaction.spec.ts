import { ConfigurationAuditService } from '../../src/modules/scheduling/application/services/configuration-audit.service.js';
import { ConfigurationEventRepository } from '../../src/modules/scheduling/infrastructure/persistence/configuration-event.repository.js';
import { ManageConfigurationUseCases } from '../../src/modules/scheduling/application/use-cases/manage-configuration.use-cases.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { redact } from '../../src/shared/observability/logger.js';
import { randomUUID } from 'node:crypto';
import { JsonLogger } from '../../src/shared/observability/logger.js';
import { Telemetry } from '../../src/shared/observability/telemetry.js';
import { adminPool, database, pool, resetDatabase, closeDatabase } from '../e2e/support.js';
import { seedSchedulingFixture, schedulingFixtureIds as ids } from '../e2e/scheduling-support.js';
import { IdempotentMutationService } from '../../src/modules/scheduling/application/services/idempotent-mutation.service.js';
import { SchedulingObservabilityService } from '../../src/modules/scheduling/application/services/scheduling-observability.service.js';
import { SchedulingTelemetryAdapter } from '../../src/modules/scheduling/infrastructure/observability/scheduling-telemetry.adapter.js';
import { SchedulingTransactionAdapter } from '../../src/modules/scheduling/infrastructure/persistence/scheduling-transaction.adapter.js';
import { AppointmentIdempotencyRepository } from '../../src/modules/scheduling/infrastructure/persistence/appointment-idempotency.repository.js';
import { AesGcmIdempotencyCipher } from '../../src/modules/scheduling/infrastructure/crypto/idempotency-cipher.adapter.js';
import { IanaTimeZoneAdapter } from '../../src/modules/scheduling/infrastructure/time/iana-time-zone.adapter.js';
import { AvailabilityRepository } from '../../src/modules/scheduling/infrastructure/persistence/availability.repository.js';
import { PublicCatalogRepository } from '../../src/modules/scheduling/infrastructure/persistence/public-catalog.repository.js';
import { AppointmentRepository } from '../../src/modules/scheduling/infrastructure/persistence/appointment.repository.js';
import { AppointmentEventRepository } from '../../src/modules/scheduling/infrastructure/persistence/appointment-event.repository.js';
import { AppointmentLifecycleRepository } from '../../src/modules/scheduling/infrastructure/persistence/appointment-lifecycle.repository.js';
import { CreateGuestAppointmentUseCase } from '../../src/modules/scheduling/application/use-cases/create-guest-appointment.use-case.js';
import { AppointmentLifecycleService } from '../../src/modules/scheduling/application/services/appointment-lifecycle.service.js';
import { ConfigurationConflictRepository } from '../../src/modules/scheduling/infrastructure/persistence/configuration-conflict.repository.js';
import { ConfigurationConflictService } from '../../src/modules/scheduling/application/services/configuration-conflict.service.js';
import { ApplicationError } from '../../src/shared/application/application-error.js';
describe('security redaction', () => {
  it('redacts scheduling contacts, raw network addresses, idempotency keys and encryption secrets', () => {
    expect(
      redact({
        name: 'Pessoa Privada',
        guest_name: 'Pessoa Privada',
        customerName: 'Pessoa Privada',
        guest_phone: '+5511999999999',
        customerPhone: '+5511888888888',
        idempotencyKey: 'private-key-123456789',
        raw_ip: '203.0.113.9',
        IDEMPOTENCY_ENCRYPTION_KEY: 'private-secret',
        nested: [{ phone: 'private-phone', email: 'private@example.test', safe: 'ok' }],
      }),
    ).toEqual({
      name: '[REDACTED]',
      guest_name: '[REDACTED]',
      customerName: '[REDACTED]',
      guest_phone: '[REDACTED]',
      customerPhone: '[REDACTED]',
      idempotencyKey: '[REDACTED]',
      raw_ip: '[REDACTED]',
      IDEMPOTENCY_ENCRYPTION_KEY: '[REDACTED]',
      nested: [{ phone: '[REDACTED]', email: '[REDACTED]', safe: 'ok' }],
    });
  });
  it('redacts secrets and personal data recursively', () =>
    expect(
      redact({
        authorization: 'Bearer token',
        nested: { code: '123456', email: 'person@example.test', safe: 'ok' },
        access_token: 'jwt',
      }),
    ).toEqual({
      authorization: '[REDACTED]',
      nested: { code: '[REDACTED]', email: '[REDACTED]', safe: 'ok' },
      access_token: '[REDACTED]',
    }));
});

describe.runIf(Boolean(process.env.DATABASE_URL))(
  'scheduling privacy across real transactions',
  () => {
    beforeEach(async () => {
      await resetDatabase();
      await seedSchedulingFixture(pool);
    });
    it('keeps contacts, raw keys, IPs and secrets out of public responses, errors, audit events and telemetry; encrypts administrative replay', async () => {
      const privateValues = [
        'Pessoa Privada Sentinela',
        '+5511888877777',
        'sentinela@example.test',
        'private-idempotency-key-sentinel',
        '203.0.113.27',
        'private-encryption-secret',
      ];
      const lines: string[] = [];
      const telemetry = new Telemetry({ logger: new JsonLogger((line) => lines.push(line)) });
      const tx = new SchedulingTransactionAdapter(database);
      const zones = new IanaTimeZoneAdapter();
      const correlationId = randomUUID();
      const idempotency = new IdempotentMutationService(
        tx,
        new AppointmentIdempotencyRepository(new AesGcmIdempotencyCipher(Buffer.alloc(32, 7))),
        { now: () => new Date('2030-01-07T11:00Z') },
        new SchedulingObservabilityService(new SchedulingTelemetryAdapter(telemetry)),
      );
      const availability = new AvailabilityRepository(database, zones);
      const events = new AppointmentEventRepository();
      const booking = new CreateGuestAppointmentUseCase(
        new PublicCatalogRepository(database),
        availability,
        zones,
        idempotency,
        new AppointmentRepository(),
        events,
      );
      const request = {
        tenantSlug: 'fixture-a',
        serviceId: ids.service,
        professionalId: ids.professional,
        startsAt: '2030-01-07T10:00:00-03:00',
        guestName: privateValues[0] ?? '',
        guestPhone: privateValues[1] ?? '',
        guestEmail: privateValues[2] ?? '',
        idempotencyKey: privateValues[3] ?? '',
        correlationId,
      };
      try {
        const created = await booking.execute(request);
        expect(created.status).toBe(201);
        for (const value of privateValues) expect(JSON.stringify(created)).not.toContain(value);
        expect(JSON.stringify(created)).not.toContain('client@example.test');
        await expect(
          booking.execute({ ...request, idempotencyKey: randomUUID() }),
        ).rejects.toMatchObject({ status: 409 });
        const lifecycle = new AppointmentLifecycleService(
          idempotency,
          new AppointmentLifecycleRepository(database),
          events,
          availability,
          zones,
        );
        const original = {
          tenantId: ids.tenantA,
          membershipId: ids.administrator,
          appointmentId: String(created.body.id),
          idempotencyKey: randomUUID(),
          correlationId,
        };
        const cancelled = await lifecycle.execute(original, { kind: 'cancel' });
        expect(JSON.stringify(cancelled)).toContain(privateValues[2]);
        expect(await lifecycle.execute(original, { kind: 'cancel' })).toEqual(cancelled);
        const ciphertext = await pool.query<{ response_ciphertext: Buffer }>(
          'SELECT response_ciphertext FROM scheduling.idempotency_records WHERE tenant_id=$1',
          [ids.tenantA],
        );
        for (const row of ciphertext.rows)
          for (const value of privateValues)
            expect(row.response_ciphertext.includes(Buffer.from(value))).toBe(false);
        const audit = await pool.query(
          'SELECT * FROM scheduling.appointment_events WHERE tenant_id=$1',
          [ids.tenantA],
        );
        for (const value of privateValues) expect(JSON.stringify(audit.rows)).not.toContain(value);
        expect(audit.rows.every((row) => row.correlation_id === correlationId)).toBe(true);
        const conflicts = new ConfigurationConflictService(new ConfigurationConflictRepository());
        await expect(
          tx.runForTenant(ids.tenantB, (context) =>
            conflicts.rejectIfAny(context, ids.tenantB, {
              kind: 'professional-inactive',
              professionalId: ids.professional,
            }),
          ),
        ).resolves.toBeUndefined();
        try {
          await tx.runForTenant(ids.tenantA, (context) =>
            conflicts.rejectIfAny(context, ids.tenantA, {
              kind: 'professional-inactive',
              professionalId: ids.professional,
            }),
          );
          throw new Error('expected conflict');
        } catch (error) {
          expect(error).toBeInstanceOf(ApplicationError);
          expect(error).toMatchObject({
            status: 409,
            conflictingAppointmentIds: [ids.appointment],
          });
          for (const value of privateValues) expect(String(error)).not.toContain(value);
        }
        const configEvents = new ConfigurationEventRepository();
        const configuration = new ManageConfigurationUseCases(
          database,
          idempotency,
          zones,
          conflicts,
          new ConfigurationAuditService(configEvents, configEvents),
        );
        await configuration.updateService(
          { tenantId: ids.tenantA, membershipId: ids.administrator, correlationId },
          randomUUID(),
          ids.service,
          { description: privateValues[2] },
        );
        const configAudit = await adminPool.query(
          'SELECT changes FROM scheduling.configuration_events WHERE tenant_id=$1',
          [ids.tenantA],
        );
        expect(configAudit.rows).toHaveLength(1);
        for (const value of privateValues)
          expect(JSON.stringify(configAudit.rows)).not.toContain(value);
        await telemetry.forceFlush();
        for (const value of privateValues) expect(lines.join('')).not.toContain(value);
        expect(
          lines
            .map((line) => JSON.parse(line))
            .every((row) => row.correlation_id === correlationId && row.tenant_id === ids.tenantA),
        ).toBe(true);
        expect([...telemetry.metrics.snapshot().keys()].join('')).not.toContain(ids.tenantA);
      } finally {
        await telemetry.onModuleDestroy();
      }
    });
    it('omite credenciais sintéticas sem rótulo em todos os textos livres anteriores e novos', async () => {
      const samples = [
        'ghp_' + 'X'.repeat(36),
        '-----BEGIN PRIVATE KEY-----\n' + 'Y'.repeat(32) + '\n-----END PRIVATE KEY-----',
        'opaqueUnlabelledValue',
      ];
      const lines: string[] = [];
      const telemetry = new Telemetry({ logger: new JsonLogger((line) => lines.push(line)) });
      const correlationId = randomUUID();
      const idempotency = new IdempotentMutationService(
        new SchedulingTransactionAdapter(database),
        new AppointmentIdempotencyRepository(new AesGcmIdempotencyCipher(Buffer.alloc(32, 7))),
        { now: () => new Date('2030-01-07T11:00Z') },
        new SchedulingObservabilityService(new SchedulingTelemetryAdapter(telemetry)),
      );
      const events = new ConfigurationEventRepository();
      const configuration = new ManageConfigurationUseCases(
        database,
        idempotency,
        new IanaTimeZoneAdapter(),
        new ConfigurationConflictService(new ConfigurationConflictRepository()),
        new ConfigurationAuditService(events, events),
      );
      const auth = { tenantId: ids.tenantA, membershipId: ids.administrator, correlationId };
      try {
        for (const value of [...samples, 'Texto comum']) {
          await configuration.updateService(auth, randomUUID(), ids.service, {
            name: value,
            description: value,
          });
          await configuration.updateProfessional(auth, randomUUID(), ids.professional, {
            display_name: value,
          });
          const exception = (await configuration.createException(
            auth,
            randomUUID(),
            ids.professional,
            {
              kind: 'blocked',
              starts_at: '2030-01-08T12:00Z',
              ends_at: '2030-01-08T13:00Z',
              reason: value,
            },
          )) as { id: string };
          await configuration.deleteException(auth, randomUUID(), ids.professional, exception.id);
        }
        const rows = (await adminPool.query('SELECT changes FROM scheduling.configuration_events'))
          .rows;
        expect(rows.length).toBeGreaterThan(0);
        let rejected: unknown;
        try {
          await configuration.updateService(auth, randomUUID(), ids.service, {
            status: 'inactive',
          });
        } catch (error) {
          rejected = error;
        }
        expect(rejected).toMatchObject({ status: 409 });
        await telemetry.forceFlush();
        const output = JSON.stringify(rows) + JSON.stringify(rejected) + lines.join('');
        for (const value of samples) expect(output).not.toContain(value);
        for (const row of rows)
          for (const field of ['name', 'description', 'display_name', 'reason']) {
            const change = row.changes[field];
            if (change) expect(change).toMatchObject({ redacted: true });
          }
      } finally {
        await telemetry.onModuleDestroy();
      }
    });
    afterAll(closeDatabase);
  },
);
