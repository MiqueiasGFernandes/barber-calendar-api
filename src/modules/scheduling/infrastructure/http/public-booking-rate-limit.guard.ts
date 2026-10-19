import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ApplicationError } from '../../../../shared/application/application-error.js';
import { DATABASE } from '../../../authentication/authentication.module.js';
import type { PostgresPool } from '../../../../shared/database/postgres-pool.js';
import { ENVIRONMENT } from '../../../../shared/config/config.module.js';
import type { Environment } from '../../../../shared/config/environment.schema.js';
import { PublicThrottleRepository } from '../persistence/public-throttle.repository.js';

export const PUBLIC_THROTTLE_GROUP='public-throttle-group';
@Injectable()
export class PublicBookingRateLimitGuard implements CanActivate {
  private readonly throttle:PublicThrottleRepository;
  constructor(private readonly reflector:Reflector,@Inject(DATABASE) private readonly database:PostgresPool,@Inject(ENVIRONMENT) environment:Environment){this.throttle=new PublicThrottleRepository(database,environment.THROTTLE_HMAC_KEY);}
  async canActivate(context:ExecutionContext):Promise<boolean>{
    const group=this.reflector.get<'read'|'booking'>(PUBLIC_THROTTLE_GROUP,context.getHandler());
    if(!group)return true;
    const request=context.switchToHttp().getRequest<FastifyRequest & {params:{tenant_slug?:string}}>();
    const slug=request.params.tenant_slug;
    if(!slug||!/^([a-z0-9]+)(-[a-z0-9]+)*$/.test(slug))throw new ApplicationError(422,'validation_error','Invalid tenant slug');
    const tenant=await this.throttleTenant(slug);
    const ip=request.ip;
    const result=await this.throttle.consume(tenant,ip,group);
    if(!result.allowed)throw new ApplicationError(429,'rate_limited','Too many requests',result.retryAfterSeconds);
    return true;
  }
  private async throttleTenant(slug:string):Promise<string>{
    const result=await this.database.query<{id:string}>(`SELECT id FROM tenancy.tenants WHERE slug=$1 AND status='active'`,[slug]);
    const row=result.rows[0];if(!row)throw new ApplicationError(404,'not_found','Tenant not found');return row.id;
  }
}
