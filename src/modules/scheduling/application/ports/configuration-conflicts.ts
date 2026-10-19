import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type { WeeklyWorkPeriod } from '../../domain/work-period.js';

export type ConfigurationConflict =
  | { kind:'service-inactive'; serviceId:string }
  | { kind:'service-professionals'; serviceId:string; professionalIds:string[] }
  | { kind:'professional-inactive'; professionalId:string }
  | { kind:'weekly-periods'; professionalId:string; periods:WeeklyWorkPeriod[] }
  | { kind:'exception'; professionalId:string; startsAt:Date; endsAt:Date }
  | { kind:'time-zone'; timeZone:string };
export interface ConfigurationConflictRepositoryPort {
  findConfirmedAppointments(context:TransactionContext,tenantId:string,change:ConfigurationConflict):Promise<string[]>;
}
