import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApplicationError } from '../../../../shared/application/application-error.js';
import type { AuthorizedSession } from '../../../tenancy/application/ports/session-authorizer.js';
import { TenantSessionGuard } from '../../../authentication/infrastructure/http/tenant-session.guard.js';
import type { StoredResponse } from '../../application/ports/idempotency-cipher.js';
import { ListAppointmentsUseCase } from '../../application/use-cases/list-appointments.use-case.js';
import { CancelAppointmentUseCase } from '../../application/use-cases/cancel-appointment.use-case.js';
import { RescheduleAppointmentUseCase } from '../../application/use-cases/reschedule-appointment.use-case.js';
import { RecordAppointmentOutcomeUseCase } from '../../application/use-cases/record-appointment-outcome.use-case.js';
import { AdministratorGuard } from './administrator.guard.js';
import { SchedulingExceptionFilter } from './scheduling-exception.filter.js';
import { parseSchedulingInput, requireIdempotencyKey, uuidSchema } from './dto/common.schemas.js';
import {
  appointmentFiltersSchema,
  cancellationSchema,
  reschedulingSchema,
  outcomeSchema,
} from './dto/appointment-management.schemas.js';

type Request = FastifyRequest & { auth?: AuthorizedSession };
@Controller('v1/management/appointments')
@UseGuards(TenantSessionGuard, AdministratorGuard)
@UseFilters(SchedulingExceptionFilter)
export class AppointmentManagementController {
  constructor(
    @Inject(ListAppointmentsUseCase) private readonly list: ListAppointmentsUseCase,
    @Inject(CancelAppointmentUseCase) private readonly cancel: CancelAppointmentUseCase,
    @Inject(RescheduleAppointmentUseCase) private readonly reschedule: RescheduleAppointmentUseCase,
    @Inject(RecordAppointmentOutcomeUseCase)
    private readonly outcome: RecordAppointmentOutcomeUseCase,
  ) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  appointments(@Req() request: Request, @Query() rawQuery: unknown) {
    const auth = this.session(request);
    const query = parseSchedulingInput(appointmentFiltersSchema, rawQuery);
    return this.list.execute(auth.tenantId, {
      startsFrom: new Date(query.starts_from),
      endsBefore: new Date(query.ends_before),
      ...(query.professional_id ? { professionalId: query.professional_id } : {}),
      ...(query.status ? { status: query.status } : {}),
    });
  }
  @Post(':appointment_id/cancellation')
  @HttpCode(200)
  async cancellation(
    @Req() request: Request,
    @Param('appointment_id') id: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = this.input(request, id, key);
    parseSchedulingInput(cancellationSchema, body);
    return this.respond(reply, await this.cancel.execute(input));
  }
  @Post(':appointment_id/rescheduling')
  @HttpCode(200)
  async rescheduling(
    @Req() request: Request,
    @Param('appointment_id') id: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = this.input(request, id, key);
    const parsed = parseSchedulingInput(reschedulingSchema, body);
    return this.respond(
      reply,
      await this.reschedule.execute({ ...input, startsAt: parsed.starts_at }),
    );
  }
  @Post(':appointment_id/outcome')
  @HttpCode(200)
  async recordOutcome(
    @Req() request: Request,
    @Param('appointment_id') id: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = this.input(request, id, key);
    const parsed = parseSchedulingInput(outcomeSchema, body);
    return this.respond(reply, await this.outcome.execute({ ...input, status: parsed.status }));
  }
  private session(request: Request) {
    if (!request.auth) throw new ApplicationError(401, 'unauthorized', 'Unauthorized');
    return request.auth;
  }
  private input(request: Request, id: unknown, key: unknown) {
    const auth = this.session(request);
    return {
      tenantId: auth.tenantId,
      membershipId: auth.membershipId,
      appointmentId: parseSchedulingInput(uuidSchema, id),
      idempotencyKey: requireIdempotencyKey(key),
      correlationId: request.id,
    };
  }
  private respond(reply: FastifyReply, response: StoredResponse) {
    reply.code(response.status);
    for (const [key, value] of Object.entries(response.headers)) reply.header(key, value);
    return response.body;
  }
}
