import { Body, Controller, Headers, HttpCode, Inject, Param, Post, Res, SetMetadata, UseFilters, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CreateGuestAppointmentUseCase } from '../../application/use-cases/create-guest-appointment.use-case.js';
import { SchedulingExceptionFilter } from './scheduling-exception.filter.js';
import { PublicBookingRateLimitGuard, PUBLIC_THROTTLE_GROUP } from './public-booking-rate-limit.guard.js';
import { guestAppointmentSchema, tenantSlugSchema } from './dto/public.schemas.js';
import { parseSchedulingInput, requireIdempotencyKey } from './dto/common.schemas.js';

export const CREATE_GUEST_APPOINTMENT = Symbol('CREATE_GUEST_APPOINTMENT');

@Controller('v1/public/tenants/:tenant_slug/appointments')
@UseFilters(SchedulingExceptionFilter)
@UseGuards(PublicBookingRateLimitGuard)
export class PublicAppointmentsController {
  constructor(@Inject(CREATE_GUEST_APPOINTMENT) private readonly createAppointment: CreateGuestAppointmentUseCase) {}

  @Post()
  @HttpCode(201)
  @SetMetadata(PUBLIC_THROTTLE_GROUP, 'booking')
  async create(
    @Param('tenant_slug') rawSlug: unknown,
    @Headers('idempotency-key') rawKey: unknown,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const slug = parseSchedulingInput(tenantSlugSchema, rawSlug);
    const body = parseSchedulingInput(guestAppointmentSchema, rawBody);
    const key = requireIdempotencyKey(rawKey);
    const response = await this.createAppointment.execute({
      tenantSlug: slug,
      serviceId: body.service_id,
      ...(body.professional_id === undefined ? {} : { professionalId: body.professional_id }),
      startsAt: body.starts_at,
      guestName: body.guest_name,
      guestPhone: body.guest_phone,
      guestEmail: body.guest_email,
      idempotencyKey: key,
    });
    reply.code(response.status);
    for (const [name, value] of Object.entries(response.headers)) reply.header(name, value);
    return response.body;
  }
}
