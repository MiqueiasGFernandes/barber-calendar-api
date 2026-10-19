import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type {
  AuditValue,
  ConfigurationAuditReader,
  ConfigurationAuditWriter,
  ConfigurationEvent,
  ConfigurationResourceType,
  ConfigurationSnapshot,
} from '../../application/ports/configuration-audit-writer.js';

export class ConfigurationEventRepository
  implements ConfigurationAuditWriter, ConfigurationAuditReader
{
  async append(context: TransactionContext, event: ConfigurationEvent): Promise<void> {
    await context.query(
      'INSERT INTO scheduling.configuration_events(id,tenant_id,actor_membership_id,operation_id,operation,resource_type,resource_id,occurred_at,correlation_id,changes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',
      [
        event.id,
        event.tenantId,
        event.actorMembershipId,
        event.operationId,
        event.operation,
        event.resourceType,
        event.resourceId,
        event.occurredAt,
        event.correlationId,
        JSON.stringify(event.changes),
      ],
    );
  }
  async snapshot(
    context: TransactionContext,
    tenantId: string,
    type: ConfigurationResourceType,
    id: string,
  ): Promise<ConfigurationSnapshot> {
    const queries: Record<ConfigurationResourceType, string> = {
      service: `SELECT name,description,duration_minutes,price_minor,currency AS currency_code,status,ARRAY(SELECT professional_id::text FROM scheduling.professional_services WHERE tenant_id=$1 AND service_id=$2 ORDER BY professional_id) professional_ids FROM scheduling.services WHERE tenant_id=$1 AND id=$2`,
      professional:
        'SELECT name AS display_name,status FROM scheduling.professionals WHERE tenant_id=$1 AND id=$2',
      time_zone: 'SELECT time_zone FROM tenancy.tenants WHERE id=$1 AND id=$2',
      tenant_settings:
        'SELECT slot_interval_minutes,minimum_advance_minutes FROM scheduling.tenant_settings WHERE tenant_id=$1 AND tenant_id=$2',
      availability_exception:
        'SELECT professional_id::text,kind,to_char(starts_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') starts_at,to_char(ends_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') ends_at,reason FROM scheduling.availability_exceptions WHERE tenant_id=$1 AND id=$2',
      weekly_periods:
        'SELECT iso_weekday,starts_at::text AS starts_local_time,ends_at::text AS ends_local_time FROM scheduling.weekly_periods WHERE tenant_id=$1 AND professional_id=$2 ORDER BY iso_weekday,starts_at,ends_at',
    };
    const result = await context.query<Record<string, AuditValue>>(queries[type], [tenantId, id]);
    return type === 'weekly_periods' ? { periods: result.rows } : (result.rows[0] ?? null);
  }
}
