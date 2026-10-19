import type { PostgresPool } from '../../../../shared/database/postgres-pool.js';
import type { TimeZoneConverter } from '../../application/ports/time-zone.js';
import type { AvailabilityProfessional } from '../../domain/availability.js';
import type { AvailabilityPort, AvailabilitySnapshot, PublicService } from '../../application/ports/scheduling-repository.js';

export class AvailabilityRepository implements AvailabilityPort {
  constructor(private readonly database:PostgresPool,private readonly zones:TimeZoneConverter){}
  async load(tenantId:string,serviceId:string,date:string):Promise<AvailabilitySnapshot|null>{
    const client=await this.database.connect();
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const setting=await client.query<{time_zone:string;slot_interval_minutes:number;minimum_advance_minutes:number}>(`SELECT t.time_zone,s.slot_interval_minutes,s.minimum_advance_minutes FROM scheduling.tenant_settings s JOIN tenancy.tenants t ON t.id=s.tenant_id WHERE s.tenant_id=$1`,[tenantId]);
      const config=setting.rows[0]; if(!config){await client.query('COMMIT');return null;}
      const nextDate=new Date(`${date}T00:00:00Z`); nextDate.setUTCDate(nextDate.getUTCDate()+1);
      const dayStart=this.zones.localDateTimeToInstants(`${date}T00:00:00`,config.time_zone)[0]??new Date(`${date}T00:00:00Z`);
      const nextDay=nextDate.toISOString().slice(0,10);
      const dayEnd=this.zones.localDateTimeToInstants(`${nextDay}T00:00:00`,config.time_zone).at(-1)??new Date(dayStart.getTime()+24*60*60_000);
      const serviceRows=await client.query<{id:string;name:string;duration_minutes:number;price_minor:number;currency:string;professional_id:string;professional_name:string}>(
        `SELECT s.id,s.name,s.duration_minutes,s.price_minor,s.currency,p.id professional_id,p.name professional_name FROM scheduling.services s
         JOIN scheduling.professional_services ps ON ps.tenant_id=s.tenant_id AND ps.service_id=s.id JOIN scheduling.professionals p ON p.tenant_id=ps.tenant_id AND p.id=ps.professional_id
         WHERE s.tenant_id=$1 AND s.id=$2 AND s.status='active' AND p.status='active' ORDER BY p.id`,[tenantId,serviceId]);
      const first=serviceRows.rows[0]; if(!first){await client.query('COMMIT');return null;}
      const service:PublicService={id:first.id,name:first.name,duration_minutes:first.duration_minutes,price_minor:first.price_minor,currency_code:first.currency,professionals:serviceRows.rows.map((r)=>({id:r.professional_id,display_name:r.professional_name}))};
      const day=new Date(`${date}T00:00:00Z`);const weekday=day.getUTCDay()===0?7:day.getUTCDay();
      const professionals:AvailabilityProfessional[]=[];
      for(const item of serviceRows.rows){
        const periods=await client.query<{starts_at:string;ends_at:string}>(`SELECT starts_at::text,ends_at::text FROM scheduling.weekly_periods WHERE tenant_id=$1 AND professional_id=$2 AND iso_weekday=$3 ORDER BY starts_at`,[tenantId,item.professional_id,weekday]);
        const exceptions=await client.query<{starts_at:Date;ends_at:Date}>(`SELECT starts_at,ends_at FROM scheduling.availability_exceptions WHERE tenant_id=$1 AND professional_id=$2 AND starts_at<$4 AND ends_at>$3`,[tenantId,item.professional_id,dayStart,dayEnd]);
        const appointments=await client.query<{starts_at:Date;ends_at:Date}>(`SELECT starts_at,ends_at FROM scheduling.appointments WHERE tenant_id=$1 AND professional_id=$2 AND status='confirmed' AND starts_at<$4 AND ends_at>$3`,[tenantId,item.professional_id,dayStart,dayEnd]);
        professionals.push({id:item.professional_id,periods:periods.rows.map((r)=>({startsAt:r.starts_at,endsAt:r.ends_at})),exceptions:exceptions.rows.map((r)=>({startsAt:r.starts_at,endsAt:r.ends_at})),appointments:appointments.rows.map((r)=>({startsAt:r.starts_at,endsAt:r.ends_at}))});
      }
      await client.query('COMMIT');
      return {tenantId,timeZone:config.time_zone,slotIntervalMinutes:config.slot_interval_minutes,minimumAdvanceMinutes:config.minimum_advance_minutes,service,professionals};
    }catch(error){try{await client.query('ROLLBACK');}catch{/* preserve */}throw error;}finally{client.release();}
  }
}
