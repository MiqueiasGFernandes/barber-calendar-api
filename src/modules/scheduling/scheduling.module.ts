import { Module } from '@nestjs/common';
import { ENVIRONMENT } from '../../shared/config/config.module.js';
import type { Environment } from '../../shared/config/environment.schema.js';
import { DATABASE } from '../authentication/authentication.module.js';
import type { PostgresPool } from '../../shared/database/postgres-pool.js';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { AdministratorGuard } from './infrastructure/http/administrator.guard.js';
import { SchedulingExceptionFilter } from './infrastructure/http/scheduling-exception.filter.js';
import { SchedulingTransactionAdapter } from './infrastructure/persistence/scheduling-transaction.adapter.js';
import { AesGcmIdempotencyCipher } from './infrastructure/crypto/idempotency-cipher.adapter.js';
import { AppointmentIdempotencyRepository } from './infrastructure/persistence/appointment-idempotency.repository.js';
import { AppointmentEventRepository } from './infrastructure/persistence/appointment-event.repository.js';
import { SystemClock } from '../../shared/application/ports/clock.js';
import { SchedulingMutationService } from './application/services/scheduling-mutation.service.js';
import { IdempotentMutationService } from './application/services/idempotent-mutation.service.js';
import { IanaTimeZoneAdapter } from './infrastructure/time/iana-time-zone.adapter.js';
import { PublicCatalogRepository } from './infrastructure/persistence/public-catalog.repository.js';
import { AvailabilityRepository } from './infrastructure/persistence/availability.repository.js';
import { ListPublicServicesUseCase } from './application/use-cases/list-public-services.use-case.js';
import { GetPublicAvailabilityUseCase } from './application/use-cases/get-public-availability.use-case.js';
import { LIST_PUBLIC_SERVICES, GET_PUBLIC_AVAILABILITY, PublicCatalogController } from './infrastructure/http/public-catalog.controller.js';
import { PublicBookingRateLimitGuard } from './infrastructure/http/public-booking-rate-limit.guard.js';
import { AppointmentRepository } from './infrastructure/persistence/appointment.repository.js';
import { CreateGuestAppointmentUseCase } from './application/use-cases/create-guest-appointment.use-case.js';
import { CREATE_GUEST_APPOINTMENT, PublicAppointmentsController } from './infrastructure/http/public-appointments.controller.js';

export const SCHEDULING_TRANSACTION = Symbol('SCHEDULING_TRANSACTION');
export const IDEMPOTENCY_CIPHER = Symbol('IDEMPOTENCY_CIPHER');
export const APPOINTMENT_IDEMPOTENCY = Symbol('APPOINTMENT_IDEMPOTENCY');
export const SCHEDULING_CLOCK = Symbol('SCHEDULING_CLOCK');
export const TIME_ZONE_CONVERTER = Symbol('TIME_ZONE_CONVERTER');

@Module({
  imports: [AuthenticationModule],
  controllers: [PublicCatalogController, PublicAppointmentsController],
  providers: [
    AdministratorGuard,
    SchedulingExceptionFilter,
    PublicBookingRateLimitGuard,
    { provide: SCHEDULING_CLOCK, useClass: SystemClock },
    { provide: TIME_ZONE_CONVERTER, useFactory: () => new IanaTimeZoneAdapter() },
    { provide: SCHEDULING_TRANSACTION, inject: [DATABASE], useFactory: (db: PostgresPool) => new SchedulingTransactionAdapter(db) },
    { provide: IDEMPOTENCY_CIPHER, inject: [ENVIRONMENT], useFactory: (env: Environment) => new AesGcmIdempotencyCipher(env.IDEMPOTENCY_ENCRYPTION_KEY) },
    { provide: APPOINTMENT_IDEMPOTENCY, inject: [IDEMPOTENCY_CIPHER], useFactory: (cipher: AesGcmIdempotencyCipher) => new AppointmentIdempotencyRepository(cipher) },
    AppointmentEventRepository,
    { provide: SchedulingMutationService, inject: [SCHEDULING_TRANSACTION,SCHEDULING_CLOCK], useFactory: (tx:SchedulingTransactionAdapter,clock:SystemClock) => new SchedulingMutationService(tx,clock) },
    { provide: IdempotentMutationService, inject: [SCHEDULING_TRANSACTION,APPOINTMENT_IDEMPOTENCY,SCHEDULING_CLOCK], useFactory: (tx:SchedulingTransactionAdapter,records:AppointmentIdempotencyRepository,clock:SystemClock) => new IdempotentMutationService(tx,records,clock) },
    { provide: PublicCatalogRepository, inject: [DATABASE], useFactory: (db:PostgresPool) => new PublicCatalogRepository(db) },
    { provide: AvailabilityRepository, inject: [DATABASE,TIME_ZONE_CONVERTER], useFactory: (db:PostgresPool,zones:IanaTimeZoneAdapter) => new AvailabilityRepository(db,zones) },
    AppointmentRepository,
    { provide: CREATE_GUEST_APPOINTMENT, inject: [PublicCatalogRepository,AvailabilityRepository,TIME_ZONE_CONVERTER,IdempotentMutationService,AppointmentRepository,AppointmentEventRepository], useFactory: (catalog:PublicCatalogRepository,availability:AvailabilityRepository,zones:IanaTimeZoneAdapter,idempotency:IdempotentMutationService,appointments:AppointmentRepository,events:AppointmentEventRepository) => new CreateGuestAppointmentUseCase(catalog,availability,zones,idempotency,appointments,events) },
    { provide: LIST_PUBLIC_SERVICES, inject: [PublicCatalogRepository], useFactory: (catalog:PublicCatalogRepository) => new ListPublicServicesUseCase(catalog) },
    { provide: GET_PUBLIC_AVAILABILITY, inject: [PublicCatalogRepository,AvailabilityRepository,TIME_ZONE_CONVERTER,SCHEDULING_CLOCK], useFactory: (catalog:PublicCatalogRepository,availability:AvailabilityRepository,zones:IanaTimeZoneAdapter,clock:SystemClock) => new GetPublicAvailabilityUseCase(catalog,availability,zones,clock) },
  ],
  exports: [SCHEDULING_TRANSACTION, IDEMPOTENCY_CIPHER, APPOINTMENT_IDEMPOTENCY, AppointmentEventRepository, AdministratorGuard, SchedulingExceptionFilter, SchedulingMutationService, IdempotentMutationService],
})
export class SchedulingModule {}
