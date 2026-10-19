import { Controller, Get, Param, Query, UseFilters, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { GetPublicAvailabilityUseCase } from '../../application/use-cases/get-public-availability.use-case.js';
import { ListPublicServicesUseCase } from '../../application/use-cases/list-public-services.use-case.js';
import { SchedulingExceptionFilter } from './scheduling-exception.filter.js';
import { PublicBookingRateLimitGuard, PUBLIC_THROTTLE_GROUP } from './public-booking-rate-limit.guard.js';
import { SetMetadata } from '@nestjs/common';
import { availabilityQuerySchema,tenantSlugSchema } from './dto/public.schemas.js';
import { parseSchedulingInput } from './dto/common.schemas.js';

export const LIST_PUBLIC_SERVICES=Symbol('LIST_PUBLIC_SERVICES');
export const GET_PUBLIC_AVAILABILITY=Symbol('GET_PUBLIC_AVAILABILITY');
@Controller('v1/public/tenants/:tenant_slug')
@UseFilters(SchedulingExceptionFilter)
@UseGuards(PublicBookingRateLimitGuard)
export class PublicCatalogController {
  constructor(@Inject(LIST_PUBLIC_SERVICES) private readonly list:ListPublicServicesUseCase,@Inject(GET_PUBLIC_AVAILABILITY) private readonly availability:GetPublicAvailabilityUseCase){}
  @Get('services') @SetMetadata(PUBLIC_THROTTLE_GROUP,'read')
  services(@Param('tenant_slug') slug:unknown){return this.list.execute(parseSchedulingInput(tenantSlugSchema,slug));}
  @Get('availability') @SetMetadata(PUBLIC_THROTTLE_GROUP,'read')
  slots(@Param('tenant_slug') slug:unknown,@Query() query:unknown){
    const tenantSlug=parseSchedulingInput(tenantSlugSchema,slug);const parsed=parseSchedulingInput(availabilityQuerySchema,query);
    return this.availability.execute({tenantSlug,serviceId:parsed.service_id,date:parsed.date,...(parsed.professional_id?{professionalId:parsed.professional_id}:{})});
  }
}
