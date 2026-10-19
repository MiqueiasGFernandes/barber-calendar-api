import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
export const configurationOperations = [
  'createService',
  'updateService',
  'createProfessional',
  'updateProfessional',
  'replaceWeeklyWorkPeriods',
  'createAvailabilityException',
  'deleteAvailabilityException',
  'updateTenantTimeZone',
  'updateSchedulingSettings',
] as const;
export const configurationResourceTypes = [
  'service',
  'professional',
  'weekly_periods',
  'availability_exception',
  'time_zone',
  'tenant_settings',
] as const;
export type ConfigurationOperation = (typeof configurationOperations)[number];
export type ConfigurationResourceType = (typeof configurationResourceTypes)[number];
export type AuditValue =
  string | number | boolean | null | AuditValue[] | { [key: string]: AuditValue };
export type ConfigurationSnapshot = Record<string, AuditValue> | null;
export type ConfigurationChanges = Record<
  string,
  { before: AuditValue; after: AuditValue; redacted?: true }
>;
export interface ConfigurationEvent {
  id: string;
  tenantId: string;
  actorMembershipId: string;
  operationId: string;
  operation: ConfigurationOperation;
  resourceType: ConfigurationResourceType;
  resourceId: string;
  occurredAt: Date;
  correlationId: string;
  changes: ConfigurationChanges;
}
export interface ConfigurationAuditWriter {
  append(context: TransactionContext, event: ConfigurationEvent): Promise<void>;
}
export interface ConfigurationAuditReader {
  snapshot(
    context: TransactionContext,
    tenantId: string,
    type: ConfigurationResourceType,
    id: string,
  ): Promise<ConfigurationSnapshot>;
}
