import type { Queryable } from '../../../../shared/database/postgres-pool.js';
import { ApplicationError } from '../../../../shared/application/application-error.js';
import type { PublicCatalogPort, PublicService } from '../../application/ports/scheduling-repository.js';

export class PublicCatalogRepository implements PublicCatalogPort {
  constructor(private readonly database: Queryable) {}
  async tenantId(slug: string): Promise<string> {
    const result = await this.database.query<{ id: string }>(`SELECT id FROM tenancy.tenants WHERE slug=$1 AND status='active'`,[slug]);
    const row=result.rows[0]; if (!row) throw new ApplicationError(404,'not_found','Tenant not found'); return row.id;
  }
  async listServices(slug: string): Promise<PublicService[]> {
    const tenantId=await this.tenantId(slug);
    const result=await this.database.query<{ id:string; name:string; duration_minutes:number; price_minor:number; currency:string; professional_id:string; professional_name:string }>(
      `SELECT s.id,s.name,s.duration_minutes,s.price_minor,s.currency,p.id AS professional_id,p.name AS professional_name
       FROM scheduling.services s LEFT JOIN scheduling.professional_services ps ON ps.tenant_id=s.tenant_id AND ps.service_id=s.id
       LEFT JOIN scheduling.professionals p ON p.tenant_id=ps.tenant_id AND p.id=ps.professional_id AND p.status='active'
       WHERE s.tenant_id=$1 AND s.status='active' AND (p.id IS NULL OR p.status='active') ORDER BY s.name,p.name`,[tenantId]);
    const services=new Map<string,PublicService>();
    for(const row of result.rows){
      let service=services.get(row.id);
      if(!service){service={id:row.id,name:row.name,duration_minutes:row.duration_minutes,price_minor:row.price_minor,currency_code:row.currency,professionals:[]};services.set(row.id,service);}
      if(row.professional_id) service.professionals.push({id:row.professional_id,display_name:row.professional_name});
    }
    return [...services.values()].filter((service)=>service.professionals.length>0);
  }
  async findService(tenantId:string,serviceId:string):Promise<PublicService|null>{
    const rows=await this.database.query<{id:string;name:string;duration_minutes:number;price_minor:number;currency:string;professional_id:string;professional_name:string}>(
      `SELECT s.id,s.name,s.duration_minutes,s.price_minor,s.currency,p.id AS professional_id,p.name AS professional_name FROM scheduling.services s
       JOIN scheduling.professional_services ps ON ps.tenant_id=s.tenant_id AND ps.service_id=s.id
       JOIN scheduling.professionals p ON p.tenant_id=ps.tenant_id AND p.id=ps.professional_id
       WHERE s.tenant_id=$1 AND s.id=$2 AND s.status='active' AND p.status='active' ORDER BY p.name`,[tenantId,serviceId]);
    if(!rows.rows.length)return null;
    const first=rows.rows[0]; if(!first)return null;
    return {id:first.id,name:first.name,duration_minutes:first.duration_minutes,price_minor:first.price_minor,currency_code:first.currency,professionals:rows.rows.map((row)=>({id:row.professional_id,display_name:row.professional_name}))};
  }
}
