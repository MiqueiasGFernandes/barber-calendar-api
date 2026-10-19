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
import { closeDatabase, resetDatabase } from '../../e2e/support.js';
import { seedSchedulingFixture, schedulingFixtureIds } from '../../e2e/scheduling-support.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('configuration transaction concurrency',()=>{
 const connectionString=process.env.DATABASE_URL;const pool=new Pool({connectionString});const database=new PostgresPool({connectionString:connectionString??''});
 const transactions=new SchedulingTransactionAdapter(database);const clock={now:()=>new Date('2030-01-07T11:00:00Z')};const zones=new IanaTimeZoneAdapter();
 const mutations=new IdempotentMutationService(transactions,new AppointmentIdempotencyRepository(new AesGcmIdempotencyCipher(Buffer.alloc(32,9))),clock);
 const configuration=new ManageConfigurationUseCases(database,mutations,zones,new ConfigurationConflictService(new ConfigurationConflictRepository()));const auth={tenantId:schedulingFixtureIds.tenantA,membershipId:schedulingFixtureIds.administrator};
 const catalog=new PublicCatalogRepository(database);const availability=new AvailabilityRepository(database,zones);const booking=new CreateGuestAppointmentUseCase(catalog,availability,zones,mutations,new AppointmentRepository(),new AppointmentEventRepository());
 beforeEach(async()=>{await resetDatabase();await seedSchedulingFixture(pool);});
 it('serializes a booking against a new exception: exactly one writer succeeds and rollback preserves the loser',async()=>{
  const startsAt='2030-01-07T13:00:00Z';const request={tenantSlug:'fixture-a',serviceId:schedulingFixtureIds.service,professionalId:schedulingFixtureIds.professional,startsAt:'2030-01-07T10:00:00-03:00',guestName:'Novo Cliente',guestPhone:'+5511888888888',guestEmail:'new@example.test',idempotencyKey:`booking-${randomUUID()}`};
  const outcomes=await Promise.allSettled([
   booking.execute(request),
   configuration.createException(auth,`exception-${randomUUID()}`,schedulingFixtureIds.professional,{kind:'blocked',starts_at:startsAt,ends_at:'2030-01-07T13:30:00Z'}),
  ]);
  expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  expect(outcomes.filter(x=>x.status==='rejected'&&x.reason instanceof ApplicationError&&x.reason.status===409)).toHaveLength(1);
  const [appointments,exceptions]=await Promise.all([pool.query("SELECT id FROM scheduling.appointments WHERE tenant_id=$1 AND starts_at='2030-01-07T13:00:00Z' AND status='confirmed'",[auth.tenantId]),pool.query("SELECT id FROM scheduling.availability_exceptions WHERE tenant_id=$1 AND starts_at='2030-01-07T13:00:00Z'",[auth.tenantId])]);
  expect(appointments.rowCount).toBe((outcomes[0]?.status==='fulfilled')?1:0);expect(exceptions.rowCount).toBe((outcomes[1]?.status==='fulfilled')?1:0);
 });
 it('replays administrative writes, preserves appointment snapshots, and allows another tenant to proceed independently',async()=>{
  const key=`settings-${randomUUID()}`;const first=await configuration.updateSettings(auth,key,{slot_interval_minutes:20,minimum_advance_minutes:0});const replay=await configuration.updateSettings(auth,key,{slot_interval_minutes:20,minimum_advance_minutes:0});expect(replay).toEqual(first);
  await expect(configuration.updateSettings(auth,key,{slot_interval_minutes:30,minimum_advance_minutes:0})).rejects.toMatchObject({status:409});
  await configuration.updateService(auth,`service-${randomUUID()}`,schedulingFixtureIds.service,{duration_minutes:45,price_minor:7000});
  const snapshot=await pool.query<{service_name_snapshot:string;duration_minutes_snapshot:number;price_minor_snapshot:number}>('SELECT service_name_snapshot,duration_minutes_snapshot,price_minor_snapshot FROM scheduling.appointments WHERE id=$1',[schedulingFixtureIds.appointment]);expect(snapshot.rows[0]).toEqual({service_name_snapshot:'Corte de exemplo',duration_minutes_snapshot:30,price_minor_snapshot:5000});
  let release!:()=>void;let entered!:()=>void;const locked=new Promise<void>(resolve=>{entered=resolve});const hold=new Promise<void>(resolve=>{release=resolve});const firstTenant=transactions.runForTenant(auth.tenantId,async()=>{entered();await hold});await locked;
  await expect(configuration.updateSettings({tenantId:schedulingFixtureIds.tenantB,membershipId:schedulingFixtureIds.administrator},`tenant-b-${randomUUID()}`,{slot_interval_minutes:20,minimum_advance_minutes:0})).resolves.toEqual({slot_interval_minutes:20,minimum_advance_minutes:0});
  release();await firstTenant;
 });
 afterAll(async()=>{await Promise.all([pool.end(),database.close(),closeDatabase()]);});
});
