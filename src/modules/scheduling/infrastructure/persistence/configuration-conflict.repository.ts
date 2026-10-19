import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type { ConfigurationConflict, ConfigurationConflictRepositoryPort } from '../../application/ports/configuration-conflicts.js';

export class ConfigurationConflictRepository implements ConfigurationConflictRepositoryPort {
  async findConfirmedAppointments(context:TransactionContext,tenantId:string,change:ConfigurationConflict):Promise<string[]>{
    let query:string;let values:readonly unknown[];
    switch(change.kind){
      case 'service-inactive':query="SELECT id FROM scheduling.appointments WHERE tenant_id=$1 AND service_id=$2 AND status='confirmed' AND starts_at>clock_timestamp() ORDER BY id";values=[tenantId,change.serviceId];break;
      case 'service-professionals':query="SELECT id FROM scheduling.appointments WHERE tenant_id=$1 AND service_id=$2 AND status='confirmed' AND starts_at>clock_timestamp() AND NOT (professional_id=ANY($3::uuid[])) ORDER BY id";values=[tenantId,change.serviceId,change.professionalIds];break;
      case 'professional-inactive':query="SELECT id FROM scheduling.appointments WHERE tenant_id=$1 AND professional_id=$2 AND status='confirmed' AND starts_at>clock_timestamp() ORDER BY id";values=[tenantId,change.professionalId];break;
      case 'exception':query="SELECT id FROM scheduling.appointments WHERE tenant_id=$1 AND professional_id=$2 AND status='confirmed' AND starts_at>clock_timestamp() AND starts_at<$4 AND ends_at>$3 ORDER BY id";values=[tenantId,change.professionalId,change.startsAt,change.endsAt];break;
      case 'weekly-periods':query=`SELECT DISTINCT a.id FROM scheduling.appointments a WHERE a.tenant_id=$1 AND a.professional_id=$2 AND a.status='confirmed' AND a.starts_at>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM unnest($3::smallint[],$4::time[],$5::time[]) p(day,starts_at,ends_at) WHERE p.day=EXTRACT(ISODOW FROM a.starts_at AT TIME ZONE (SELECT time_zone FROM tenancy.tenants WHERE id=$1)) AND (a.starts_at AT TIME ZONE (SELECT time_zone FROM tenancy.tenants WHERE id=$1))::time>=p.starts_at AND (a.ends_at AT TIME ZONE (SELECT time_zone FROM tenancy.tenants WHERE id=$1))::time<=p.ends_at) ORDER BY a.id`;values=[tenantId,change.professionalId,change.periods.map(p=>p.isoWeekday),change.periods.map(p=>p.startsLocalTime),change.periods.map(p=>p.endsLocalTime)];break;
      case 'time-zone':query=`SELECT a.id FROM scheduling.appointments a WHERE a.tenant_id=$1 AND a.status='confirmed' AND a.starts_at>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM scheduling.weekly_periods w WHERE w.tenant_id=a.tenant_id AND w.professional_id=a.professional_id AND w.iso_weekday=EXTRACT(ISODOW FROM a.starts_at AT TIME ZONE $2) AND (a.starts_at AT TIME ZONE $2)::date=(a.ends_at AT TIME ZONE $2)::date AND (a.starts_at AT TIME ZONE $2)::time>=w.starts_at AND (a.ends_at AT TIME ZONE $2)::time<=w.ends_at) ORDER BY a.id`;values=[tenantId,change.timeZone];break;
    }
    const result=await context.query<{id:string}>(query,values);return result.rows.map(row=>row.id);
  }
}
