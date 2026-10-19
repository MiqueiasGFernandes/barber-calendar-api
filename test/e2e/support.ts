import { Pool } from 'pg';
import { PostgresPool } from '../../src/shared/database/postgres-pool.js';
import { TransactionRunner } from '../../src/shared/database/transaction-runner.js';
import { CryptoOtpAdapter } from '../../src/shared/infrastructure/crypto/otp-crypto.adapter.js';
import { OutboxCryptoAdapter } from '../../src/shared/infrastructure/crypto/outbox-crypto.adapter.js';
import { RegistrationRepository } from '../../src/modules/authentication/infrastructure/persistence/registration.repository.js';
import { ThrottleRepository } from '../../src/modules/authentication/infrastructure/persistence/throttle.repository.js';
import { OtpThrottleService } from '../../src/modules/authentication/application/services/otp-throttle.service.js';
export const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://barber_runtime:missing-test-password@localhost:55432/barber_calendar_e2e';
export const pool = new Pool({ connectionString: databaseUrl });
const adminUrl = new URL(databaseUrl);
adminUrl.username = 'postgres';
adminUrl.password = process.env.POSTGRES_ADMIN_PASSWORD ?? 'missing-admin-password';
export const adminPool = new Pool({ connectionString: adminUrl.toString() });
export const database = new PostgresPool({ connectionString: databaseUrl });
export const tx = new TransactionRunner(database);
export class FixedOtp extends CryptoOtpAdapter {
  override generate(): string {
    return '123456';
  }
}
export const otp = new FixedOtp('otp-secret-'.padEnd(32, 'x'));
export const outbox = new OutboxCryptoAdapter(Buffer.alloc(32, 9));
export const repository = new RegistrationRepository();
export const throttle = new OtpThrottleService(
  new ThrottleRepository(),
  'throttle-secret-'.padEnd(32, 'y'),
);
const testNow = new Date(Date.now() + 86_400_000);
export const clock = { now: () => new Date(testNow) };
export async function resetDatabase(): Promise<void> {
  await adminPool.query(
    `ALTER TABLE scheduling.appointment_events DISABLE TRIGGER USER;DELETE FROM audit.security_events;DELETE FROM scheduling.appointment_events;DELETE FROM scheduling.idempotency_records;DELETE FROM scheduling.appointments;DELETE FROM scheduling.professional_services;DELETE FROM scheduling.availability_exceptions;DELETE FROM scheduling.weekly_periods;DELETE FROM scheduling.professionals;DELETE FROM scheduling.services;DELETE FROM scheduling.tenant_settings;DELETE FROM scheduling.public_throttle_windows;DELETE FROM identity.email_outbox;DELETE FROM identity.authenticated_sessions;DELETE FROM identity.otp_challenges;DELETE FROM identity.registration_attempts;DELETE FROM identity.throttle_events;DELETE FROM identity.throttle_subjects;DELETE FROM tenancy.tenant_memberships;DELETE FROM identity.user_accounts;DELETE FROM tenancy.tenants;ALTER TABLE scheduling.appointment_events ENABLE TRIGGER USER;`,
  );
}
export async function closeDatabase(): Promise<void> {
  await Promise.all([pool.end(), adminPool.end(), database.close()]);
}
