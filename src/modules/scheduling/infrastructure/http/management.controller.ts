import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthorizedSession } from '../../../tenancy/application/ports/session-authorizer.js';
import { TenantSessionGuard } from '../../../authentication/infrastructure/http/tenant-session.guard.js';
import { ManageConfigurationUseCases } from '../../application/use-cases/manage-configuration.use-cases.js';
import { AdministratorGuard } from './administrator.guard.js';
import { SchedulingExceptionFilter } from './scheduling-exception.filter.js';
import { parseSchedulingInput, requireIdempotencyKey } from './dto/common.schemas.js';
import * as s from './dto/management.schemas.js';
export const MANAGE_CONFIGURATION=Symbol('MANAGE_CONFIGURATION');
type Request=FastifyRequest & {auth?:AuthorizedSession};
@Controller('v1/management') @UseGuards(TenantSessionGuard,AdministratorGuard) @UseFilters(SchedulingExceptionFilter)
export class ManagementController {
 constructor(@Inject(MANAGE_CONFIGURATION) private readonly useCases:ManageConfigurationUseCases){}
 private auth(req:Request){if(!req.auth)throw new Error('administrator guard did not populate auth');return {tenantId:req.auth.tenantId,membershipId:req.auth.membershipId,correlationId:req.id};}
 private key(v:unknown){return requireIdempotencyKey(v);}
 @Get('scheduling-settings') settings(@Req() r:Request){return this.useCases.getSettings(this.auth(r));}
 @Put('scheduling-settings') @HttpCode(200) putSettings(@Req() r:Request,@Headers('idempotency-key') k:unknown,@Body() b:unknown){return this.useCases.updateSettings(this.auth(r),this.key(k),parseSchedulingInput(s.settingsSchema,b));}
 @Get('time-zone') timeZone(@Req() r:Request){return this.useCases.getTimeZone(this.auth(r));}
 @Put('time-zone') @HttpCode(204) putTimeZone(@Req() r:Request,@Headers('idempotency-key') k:unknown,@Body() b:unknown){return this.useCases.updateTimeZone(this.auth(r),this.key(k),parseSchedulingInput(s.timeZoneSchema,b).time_zone);}
 @Get('services') services(@Req() r:Request){return this.useCases.listServices(this.auth(r));}
 @Post('services') createService(@Req() r:Request,@Headers('idempotency-key') k:unknown,@Body() b:unknown){return this.useCases.createService(this.auth(r),this.key(k),parseSchedulingInput(s.serviceInputSchema,b));}
 @Patch('services/:service_id') @HttpCode(200) updateService(@Req() r:Request,@Param('service_id') id:unknown,@Headers('idempotency-key') k:unknown,@Body() b:unknown){return this.useCases.updateService(this.auth(r),this.key(k),parseSchedulingInput(s.uuidSchema,id),parseSchedulingInput(s.servicePatchSchema,b));}
 @Get('professionals') professionals(@Req() r:Request){return this.useCases.listProfessionals(this.auth(r));}
 @Post('professionals') createProfessional(@Req() r:Request,@Headers('idempotency-key') k:unknown,@Body() b:unknown){return this.useCases.createProfessional(this.auth(r),this.key(k),parseSchedulingInput(s.professionalInputSchema,b).display_name);}
 @Patch('professionals/:professional_id') @HttpCode(200) updateProfessional(@Req() r:Request,@Param('professional_id') id:unknown,@Headers('idempotency-key') k:unknown,@Body() b:unknown){return this.useCases.updateProfessional(this.auth(r),this.key(k),parseSchedulingInput(s.uuidSchema,id),parseSchedulingInput(s.professionalPatchSchema,b));}
 @Get('professionals/:professional_id/weekly-periods') periods(@Req() r:Request,@Param('professional_id') id:unknown){return this.useCases.getPeriods(this.auth(r),parseSchedulingInput(s.uuidSchema,id));}
 @Put('professionals/:professional_id/weekly-periods') @HttpCode(200) putPeriods(@Req() r:Request,@Param('professional_id') id:unknown,@Headers('idempotency-key') k:unknown,@Body() b:unknown){const x=parseSchedulingInput(s.periodsSchema,b);return this.useCases.replacePeriods(this.auth(r),this.key(k),parseSchedulingInput(s.uuidSchema,id),x.periods.map(p=>({isoWeekday:p.iso_weekday,startsLocalTime:p.starts_local_time,endsLocalTime:p.ends_local_time})));}
 @Get('professionals/:professional_id/exceptions') exceptions(@Req() r:Request,@Param('professional_id') id:unknown,@Query() q:unknown){const p=parseSchedulingInput(s.exceptionQuerySchema,q);return this.useCases.listExceptions(this.auth(r),parseSchedulingInput(s.uuidSchema,id),p.starts_from,p.ends_before);}
 @Post('professionals/:professional_id/exceptions') createException(@Req() r:Request,@Param('professional_id') id:unknown,@Headers('idempotency-key') k:unknown,@Body() b:unknown){return this.useCases.createException(this.auth(r),this.key(k),parseSchedulingInput(s.uuidSchema,id),parseSchedulingInput(s.exceptionInputSchema,b));}
 @Delete('professionals/:professional_id/exceptions/:exception_id') @HttpCode(204) deleteException(@Req() r:Request,@Param('professional_id') id:unknown,@Param('exception_id') eid:unknown,@Headers('idempotency-key') k:unknown){return this.useCases.deleteException(this.auth(r),this.key(k),parseSchedulingInput(s.uuidSchema,id),parseSchedulingInput(s.uuidSchema,eid));}
}
