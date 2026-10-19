import 'reflect-metadata';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { TENANT_REPOSITORY, TOKEN_VERIFIER } from '../../src/modules/authentication/infrastructure/http/tenant-session.guard.js';
import { schedulingFixtureIds } from './scheduling-support.js';
import { pool, resetDatabase } from './support.js';
import { configureCorrelation, correlationRequestId } from '../../src/shared/http/correlation.js';
import { Telemetry } from '../../src/shared/observability/telemetry.js';
import { JsonLogger } from '../../src/shared/observability/logger.js';
import { SCHEDULING_CLOCK } from '../../src/modules/scheduling/scheduling.module.js';
import { SchedulingTestClock, seedSchedulingFixture } from './scheduling-support.js';

const enabled=Boolean(process.env.DATABASE_URL);
describe.runIf(enabled)('gestão administrativa de disponibilidade',()=>{
 let app:NestFastifyApplication;let telemetry:Telemetry;
 const token=(role:'administrator'|'member')=>`test-${role}`;
 const headers=(key?:string,role:'administrator'|'member'='administrator')=>({authorization:`Bearer ${token(role)}`,...(key?{'idempotency-key':key}:{})});
 const key=()=>`management-${randomUUID()}`;
 beforeAll(async()=>{
  const keys=generateKeyPairSync('rsa',{modulusLength:2048});
  Object.assign(process.env,{NODE_ENV:'test',OTP_HMAC_KEY:'otp-management-e2e-secret'.padEnd(32,'x'),THROTTLE_HMAC_KEY:'throttle-management-e2e-secret'.padEnd(32,'y'),OUTBOX_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),IDEMPOTENCY_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64'),JWT_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),JWT_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'pem'}).toString(),JWT_KEY_ID:'management-e2e-key',JWT_ISSUER:'barber-calendar-e2e',JWT_AUDIENCE:'barber-calendar-e2e',EMAIL_PROVIDER:'mailpit'});
  telemetry=new Telemetry({logger:new JsonLogger(()=>{})});
  const testClock=new SchedulingTestClock(new Date('2030-01-07T11:00:00Z'));
  const module=await Test.createTestingModule({imports:[AppModule]})
   .overrideProvider(TOKEN_VERIFIER).useValue({verify:async(value:string)=>({sub:'test-user',sid:value,tenantId:schedulingFixtureIds.tenantA,membershipId:value.endsWith('member')?schedulingFixtureIds.member:schedulingFixtureIds.administrator,role:value.endsWith('member')?'member':'administrator',issuedAt:new Date('2030-01-01Z'),expiresAt:new Date('2031-01-01Z')})})
   .overrideProvider(TENANT_REPOSITORY).useValue({authorizeSession:async(sid:string)=>({userId:'test-user',tenantId:schedulingFixtureIds.tenantA,membershipId:sid.endsWith('member')?schedulingFixtureIds.member:schedulingFixtureIds.administrator,role:sid.endsWith('member')?'member':'administrator',expiresAt:new Date('2031-01-01Z')})})
   .overrideProvider(Telemetry).useValue(telemetry)
   .overrideProvider(SCHEDULING_CLOCK).useValue(testClock).compile();
  app=module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({requestIdHeader:false,genReqId:correlationRequestId}));configureCorrelation(app,telemetry);await app.init();await app.getHttpAdapter().getInstance().ready();
 });
 beforeEach(async()=>{await resetDatabase();await seedSchedulingFixture(pool);});
 it('configura profissionais, serviços, jornada e parâmetros; protege contra conflito sem escrita parcial',async()=>{
  const p=await app.inject({method:'POST',url:'/v1/management/professionals',headers:headers(key()),payload:{display_name:'  Profissional Dois  '}});expect(p.statusCode).toBe(201);const professionalId=p.json<{id:string}>().id;
  const s=await app.inject({method:'POST',url:'/v1/management/services',headers:headers(key()),payload:{name:'Barba',duration_minutes:20,price_minor:2500,currency_code:'BRL',professional_ids:[professionalId]}});expect(s.statusCode).toBe(201);expect(s.json()).toMatchObject({name:'Barba',duration_minutes:20,professional_ids:[professionalId]});
  const periods=await app.inject({method:'PUT',url:`/v1/management/professionals/${professionalId}/weekly-periods`,headers:headers(key()),payload:{periods:[{iso_weekday:1,starts_local_time:'09:00:00',ends_local_time:'12:00:00'},{iso_weekday:1,starts_local_time:'13:00:00',ends_local_time:'17:00:00'}]}});expect(periods.statusCode).toBe(200);
  const settings=await app.inject({method:'PUT',url:'/v1/management/scheduling-settings',headers:headers(key()),payload:{slot_interval_minutes:20,minimum_advance_minutes:0}});expect(settings.statusCode).toBe(200);expect(settings.json()).toEqual({slot_interval_minutes:20,minimum_advance_minutes:0});
  const availability=await app.inject({method:'GET',url:`/v1/public/tenants/fixture-a/availability?service_id=${s.json<{id:string}>().id}&date=2030-01-07`});expect(availability.statusCode).toBe(200);expect(availability.json<{slots:{starts_at:string}[]}>().slots.slice(0,3).map(x=>x.starts_at)).toEqual(['2030-01-07T09:00:00-03:00','2030-01-07T09:20:00-03:00','2030-01-07T09:40:00-03:00']);
  const scheduleConflict=await app.inject({method:'PUT',url:`/v1/management/professionals/${schedulingFixtureIds.professional}/weekly-periods`,headers:headers(key()),payload:{periods:[{iso_weekday:1,starts_local_time:'08:00:00',ends_local_time:'09:15:00'}]}});expect(scheduleConflict.statusCode).toBe(409);expect(scheduleConflict.json()).toMatchObject({conflicting_appointment_ids:[schedulingFixtureIds.appointment]});
  const serviceConflict=await app.inject({method:'PATCH',url:`/v1/management/services/${schedulingFixtureIds.service}`,headers:headers(key()),payload:{status:'inactive'}});expect(serviceConflict.statusCode,serviceConflict.body).toBe(409);expect(serviceConflict.json()).toMatchObject({conflicting_appointment_ids:[schedulingFixtureIds.appointment]});
  const timeZone=await app.inject({method:'PUT',url:'/v1/management/time-zone',headers:headers(key()),payload:{time_zone:'Asia/Tokyo'}});expect(timeZone.statusCode).toBe(409);expect(timeZone.json()).toMatchObject({conflicting_appointment_ids:[schedulingFixtureIds.appointment]});
  const exception=await app.inject({method:'POST',url:`/v1/management/professionals/${schedulingFixtureIds.professional}/exceptions`,headers:headers(key()),payload:{kind:'blocked',starts_at:'2030-01-07T11:45:00Z',ends_at:'2030-01-07T12:15:00Z'}});expect(exception.statusCode).toBe(409);expect(exception.json()).toMatchObject({type:'urn:problem:confirmed-bookings-conflict',conflicting_appointment_ids:[schedulingFixtureIds.appointment]});
  const unchanged=await pool.query<{name:string}>('SELECT name FROM scheduling.professionals WHERE tenant_id=$1 AND id=$2',[schedulingFixtureIds.tenantA,professionalId]);expect(unchanged.rows[0]?.name).toBe('Profissional Dois');
  await pool.query("UPDATE scheduling.appointments SET status='cancelled' WHERE id=$1",[schedulingFixtureIds.appointment]);
  const retry=await app.inject({method:'POST',url:`/v1/management/professionals/${schedulingFixtureIds.professional}/exceptions`,headers:headers(key()),payload:{kind:'blocked',starts_at:'2030-01-07T11:45:00Z',ends_at:'2030-01-07T12:15:00Z'}});expect(retry.statusCode).toBe(201);
  const zoneApplied=await app.inject({method:'PUT',url:'/v1/management/time-zone',headers:headers(key()),payload:{time_zone:'Asia/Tokyo'}});expect(zoneApplied.statusCode).toBe(204);
  const preserved=await pool.query<{starts_at:Date}>('SELECT starts_at FROM scheduling.appointments WHERE id=$1',[schedulingFixtureIds.appointment]);expect(preserved.rows[0]?.starts_at.toISOString()).toBe('2030-01-07T12:00:00.000Z');
 });
 it('aplica sessão e papel antes da operação e nunca aceita tenant do payload',async()=>{
  const unauthorized=await app.inject({method:'GET',url:'/v1/management/services'});expect(unauthorized.statusCode).toBe(401);
  const member=await app.inject({method:'POST',url:'/v1/management/professionals',headers:headers(key(),'member'),payload:{display_name:'Sem permissão'}});expect(member.statusCode).toBe(403);
  const missing=await app.inject({method:'GET',url:`/v1/management/professionals/${schedulingFixtureIds.tenantB}/weekly-periods`,headers:headers()});expect(missing.statusCode).toBe(404);
  const injection=await app.inject({method:'PUT',url:'/v1/management/scheduling-settings',headers:headers(key()),payload:{slot_interval_minutes:20,minimum_advance_minutes:0,tenant_id:schedulingFixtureIds.tenantB}});expect(injection.statusCode).toBe(422);
 });
 afterAll(async()=>{await app?.close();await telemetry?.onModuleDestroy();});
});
