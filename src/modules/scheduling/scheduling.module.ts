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

export const SCHEDULING_TRANSACTION = Symbol('SCHEDULING_TRANSACTION');
export const IDEMPOTENCY_CIPHER = Symbol('IDEMPOTENCY_CIPHER');
export const APPOINTMENT_IDEMPOTENCY = Symbol('APPOINTMENT_IDEMPOTENCY');

@Module({
  imports: [AuthenticationModule],
  providers: [
    AdministratorGuard,
    SchedulingExceptionFilter,
    { provide: SCHEDULING_TRANSACTION, inject: [DATABASE], useFactory: (db: PostgresPool) => new SchedulingTransactionAdapter(db) },
    { provide: IDEMPOTENCY_CIPHER, inject: [ENVIRONMENT], useFactory: (env: Environment) => new AesGcmIdempotencyCipher(env.IDEMPOTENCY_ENCRYPTION_KEY) },
    { provide: APPOINTMENT_IDEMPOTENCY, inject: [IDEMPOTENCY_CIPHER], useFactory: (cipher: AesGcmIdempotencyCipher) => new AppointmentIdempotencyRepository(cipher) },
    AppointmentEventRepository,
  ],
  exports: [SCHEDULING_TRANSACTION, IDEMPOTENCY_CIPHER, APPOINTMENT_IDEMPOTENCY, AppointmentEventRepository, AdministratorGuard, SchedulingExceptionFilter],
})
export class SchedulingModule {}
