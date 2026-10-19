import { createHmac } from 'node:crypto';
import type { Queryable } from '../../../../shared/database/postgres-pool.js';

export type PublicThrottleGroup='read'|'booking';
export class PublicThrottleRepository {
  constructor(private readonly database:Queryable,private readonly hmacKey:string){}
  async consume(tenantId:string,ip:string,group:PublicThrottleGroup,now=new Date()):Promise<{allowed:boolean;retryAfterSeconds:number}>{
    const ipHash=createHmac('sha256',this.hmacKey).update(ip).digest();
    const limit=group==='read'?120:10;
    const result=await this.database.query<{request_count:number;window_start:Date}>(
      `INSERT INTO scheduling.public_throttle_windows(tenant_id,ip_hash,operation_group,window_start,request_count,expires_at)
       VALUES($1,$2,$3,date_trunc('minute',$4::timestamptz),1,date_trunc('minute',$4::timestamptz)+interval '2 minutes')
       ON CONFLICT(tenant_id,ip_hash,operation_group,window_start) DO UPDATE SET request_count=scheduling.public_throttle_windows.request_count+1,expires_at=EXCLUDED.expires_at
       RETURNING request_count,window_start`,[tenantId,ipHash,group,now]);
    await this.database.query('DELETE FROM scheduling.public_throttle_windows WHERE expires_at<=$1',[now]);
    const row=result.rows[0]; if(!row)return {allowed:false,retryAfterSeconds:60};
    const retryAfterSeconds=Math.max(1,Math.ceil((row.window_start.getTime()+60_000-now.getTime())/1000));
    return {allowed:row.request_count<=limit,retryAfterSeconds};
  }
}
