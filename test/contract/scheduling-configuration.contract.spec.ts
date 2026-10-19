import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { exceptionInputSchema, periodsSchema, professionalInputSchema, professionalPatchSchema, serviceInputSchema, servicePatchSchema, settingsSchema, timeZoneSchema } from '../../src/modules/scheduling/infrastructure/http/dto/management.schemas.js';

const contract=parse(readFileSync('specs/002-appointment-scheduling/contracts/openapi.yaml','utf8')) as {paths:Record<string,Record<string,{operationId?:string;responses?:Record<string,unknown>;parameters?:{name?:string;$ref?:string}[]}>>;components:{parameters:Record<string,{name:string}>;schemas:Record<string,{properties?:Record<string,unknown>;required?:string[];additionalProperties?:boolean}>}};
describe('contrato de configuração administrativa',()=>{
  it('declara exatamente as 15 operações de gestão da fase 4 com autenticação e chave nas mutações',()=>{
    const expected=['getSchedulingSettings','updateSchedulingSettings','getTenantTimeZone','updateTenantTimeZone','listManagementServices','createService','updateService','listProfessionals','createProfessional','updateProfessional','getWeeklyWorkPeriods','replaceWeeklyWorkPeriods','listAvailabilityExceptions','createAvailabilityException','deleteAvailabilityException'];
    const operations=Object.values(contract.paths).flatMap(path=>Object.values(path)).filter(op=>expected.includes(op.operationId??''));
    expect(operations.map(op=>op.operationId).sort()).toEqual([...expected].sort());
    for(const op of operations){const mutating=!['getSchedulingSettings','getTenantTimeZone','listManagementServices','listProfessionals','getWeeklyWorkPeriods','listAvailabilityExceptions'].includes(op.operationId??'');if(mutating)expect(op.parameters?.some(p=>p.name==='Idempotency-Key'||p.$ref==='#/components/parameters/IdempotencyKey')).toBe(true);}
    for(const path of Object.keys(contract.paths).filter(p=>p.startsWith('/management/'))){for(const method of ['get','post','put','patch','delete']){const op=contract.paths[path]?.[method];if(op)expect(op.responses).toHaveProperty('401');}}
  });
  it('rejeita campos fora do contrato, parâmetros inválidos e payloads que tentam escolher tenant',()=>{
    expect(settingsSchema.safeParse({slot_interval_minutes:20,minimum_advance_minutes:0,tenant_id:'x'}).success).toBe(false);
    expect(settingsSchema.safeParse({slot_interval_minutes:0,minimum_advance_minutes:-1}).success).toBe(false);
    expect(timeZoneSchema.safeParse({time_zone:'Mars/Olympus',tenant_id:'x'}).success).toBe(false);
    expect(serviceInputSchema.safeParse({name:'Corte',duration_minutes:30,price_minor:0,currency_code:'BRL',professional_ids:[],tenant_id:'x'}).success).toBe(false);
    expect(servicePatchSchema.safeParse({tenant_id:'x'}).success).toBe(false);
    expect(servicePatchSchema.safeParse({status:'inactive'}).success).toBe(true);
    expect(professionalInputSchema.safeParse({display_name:'Profissional',tenant_id:'x'}).success).toBe(false);
    expect(professionalPatchSchema.safeParse({}).success).toBe(false);
    expect(periodsSchema.safeParse({periods:[{iso_weekday:1,starts_local_time:'23:00:00',ends_local_time:'01:00:00'}]}).success).toBe(false); // Faixas que atravessam meia-noite devem ser divididas entre dias.
    expect(exceptionInputSchema.safeParse({kind:'blocked',starts_at:'2030-01-01T10:00:00Z',ends_at:'2030-01-01T11:00:00Z',tenant_id:'x'}).success).toBe(false);
  });
  it('documenta conflitos somente com IDs autorizados e exige tenant derivado da sessão',()=>{
    expect(contract.components.schemas.BookingsConflictProblem?.required).toContain('conflicting_appointment_ids');
    expect(contract.components.schemas.BookingsConflictProblem?.properties).not.toHaveProperty('guest_email');
    for(const name of ['SchedulingSettings','ServiceInput','ServicePatch','ProfessionalInput','ProfessionalPatch','WeeklyWorkPeriodInput','AvailabilityExceptionInput'])expect(contract.components.schemas[name]?.properties).not.toHaveProperty('tenant_id');
  });
});
