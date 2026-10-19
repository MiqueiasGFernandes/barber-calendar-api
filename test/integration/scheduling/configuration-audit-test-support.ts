import { randomUUID } from 'node:crypto';
import { ConfigurationAuditService } from '../../../src/modules/scheduling/application/services/configuration-audit.service.js';
import { ConfigurationEventRepository } from '../../../src/modules/scheduling/infrastructure/persistence/configuration-event.repository.js';
import { ManageConfigurationUseCases } from '../../../src/modules/scheduling/application/use-cases/manage-configuration.use-cases.js';
import { IdempotentMutationService } from '../../../src/modules/scheduling/application/services/idempotent-mutation.service.js';
import { SchedulingTransactionAdapter } from '../../../src/modules/scheduling/infrastructure/persistence/scheduling-transaction.adapter.js';
import { AppointmentIdempotencyRepository } from '../../../src/modules/scheduling/infrastructure/persistence/appointment-idempotency.repository.js';
import { AesGcmIdempotencyCipher } from '../../../src/modules/scheduling/infrastructure/crypto/idempotency-cipher.adapter.js';
import { IanaTimeZoneAdapter } from '../../../src/modules/scheduling/infrastructure/time/iana-time-zone.adapter.js';
import { ConfigurationConflictService } from '../../../src/modules/scheduling/application/services/configuration-conflict.service.js';
import { ConfigurationConflictRepository } from '../../../src/modules/scheduling/infrastructure/persistence/configuration-conflict.repository.js';
import { adminPool, database } from '../../e2e/support.js';
import { schedulingFixtureIds as ids } from '../../e2e/scheduling-support.js';
export { ids };
export const auth = {
  tenantId: ids.tenantA,
  membershipId: ids.administrator,
  correlationId: randomUUID(),
};
export const key = () => `audit-${randomUUID()}`;
export function configuration(writer = new ConfigurationEventRepository()) {
  const repository = new ConfigurationEventRepository();
  const clock = { now: () => new Date('2030-01-07T11:00:00Z') };
  const records = new AppointmentIdempotencyRepository(
    new AesGcmIdempotencyCipher(Buffer.alloc(32, 9)),
  );
  return new ManageConfigurationUseCases(
    database,
    new IdempotentMutationService(new SchedulingTransactionAdapter(database), records, clock),
    new IanaTimeZoneAdapter(),
    new ConfigurationConflictService(new ConfigurationConflictRepository()),
    new ConfigurationAuditService(repository, writer),
  );
}
export async function events() {
  return (
    await adminPool.query('SELECT * FROM scheduling.configuration_events ORDER BY occurred_at,id')
  ).rows;
}
