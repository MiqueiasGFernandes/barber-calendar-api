import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../../../shared/application/application-error.js';
import type { StoredResponse } from '../ports/idempotency-cipher.js';
import type {
  AppointmentCommand,
  AppointmentLifecyclePort,
  AppointmentMutationInput,
} from '../ports/appointment-management.js';
import type { AppointmentEventWriter } from '../ports/appointment-writer.js';
import type { AvailabilityPort } from '../ports/scheduling-repository.js';
import type { TimeZoneConverter } from '../ports/time-zone.js';
import type { IdempotentMutationService } from './idempotent-mutation.service.js';
import { Appointment } from '../../domain/appointment.js';
import { availableSlots } from '../../domain/availability.js';
import { managedAppointment } from './managed-appointment.js';

export class AppointmentLifecycleService {
  constructor(
    private readonly idempotency: IdempotentMutationService,
    private readonly appointments: AppointmentLifecyclePort,
    private readonly events: AppointmentEventWriter,
    private readonly availability: AvailabilityPort,
    private readonly zones: TimeZoneConverter,
  ) {}

  async execute(
    input: AppointmentMutationInput,
    command: AppointmentCommand,
  ): Promise<StoredResponse> {
    // Identity is immutable; resolve aliases without checking state before replay.
    const appointmentId = await this.appointments.resolveId(input.tenantId, input.appointmentId);
    if (!appointmentId) throw new ApplicationError(404, 'not_found', 'Appointment not found');
    let request: unknown = {};
    let requestedStart: Date | undefined;
    if (command.kind === 'reschedule') {
      requestedStart = new Date(command.startsAt);
      if (!Number.isFinite(requestedStart.getTime()))
        throw new ApplicationError(422, 'validation_error', 'Invalid appointment start');
      request = { starts_at: requestedStart.toISOString() };
    } else if (command.kind === 'outcome') request = { status: command.status };
    const operation = {
      cancel: 'cancel_appointment',
      reschedule: 'reschedule_appointment',
      outcome: 'record_appointment_outcome',
    }[command.kind];
    const result = await this.idempotency.execute(
      input.tenantId,
      {
        tenantId: input.tenantId,
        actorScope: input.membershipId,
        operation,
        resourceScope: appointmentId,
        key: input.idempotencyKey,
      },
      request,
      async (context, now) => {
        const record = await this.appointments.findForUpdate(
          context,
          input.tenantId,
          appointmentId,
        );
        if (!record) throw new ApplicationError(404, 'not_found', 'Appointment not found');
        if (record.status !== 'confirmed')
          throw new ApplicationError(409, 'invalid_transition', 'Appointment is final');
        const appointment = new Appointment(record);
        const previousStartsAt = appointment.startsAt;
        const previousEndsAt = appointment.endsAt;
        if (command.kind === 'reschedule') {
          if (!requestedStart)
            throw new ApplicationError(422, 'validation_error', 'Invalid appointment start');
          const date = this.zones
            .instantToLocalDateTime(requestedStart, record.timeZone)
            .slice(0, 10);
          const snapshot = await this.availability.loadInTransaction(
            context,
            input.tenantId,
            record.serviceId,
            date,
            record.id,
          );
          const slot = snapshot
            ? availableSlots({
                date,
                now,
                timeZone: snapshot.timeZone,
                slotIntervalMinutes: snapshot.slotIntervalMinutes,
                minimumAdvanceMinutes: snapshot.minimumAdvanceMinutes,
                durationMinutes: record.durationMinutes,
                professionals: snapshot.professionals,
                converter: this.zones,
                selectedProfessionalId: record.professionalId,
              }).find((candidate) => candidate.startsAt.getTime() === requestedStart.getTime())
            : undefined;
          if (!slot)
            throw new ApplicationError(
              409,
              'slot_conflict',
              'The requested time is no longer available',
            );
          appointment.reschedule(slot.startsAt, slot.endsAt);
        } else {
          try {
            if (command.kind === 'cancel') appointment.cancel();
            else appointment.recordOutcome(command.status, now);
          } catch {
            throw new ApplicationError(
              409,
              'invalid_transition',
              'Appointment outcome is not permitted yet',
            );
          }
        }
        if (!(await this.appointments.saveConfirmed(context, appointment, now)))
          throw new ApplicationError(409, 'invalid_transition', 'Appointment is final');
        await this.events.append(context, {
          id: randomUUID(),
          tenantId: input.tenantId,
          appointmentId: record.id,
          eventType:
            command.kind === 'reschedule'
              ? 'rescheduled'
              : command.kind === 'cancel'
                ? 'cancelled'
                : command.status,
          actorMembershipId: input.membershipId,
          occurredAt: now,
          correlationId: input.correlationId,
          previousStatus: 'confirmed',
          newStatus: appointment.status,
          previousStartsAt: command.kind === 'reschedule' ? previousStartsAt : null,
          previousEndsAt: command.kind === 'reschedule' ? previousEndsAt : null,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
        });
        const body = managedAppointment(
          {
            ...record,
            status: appointment.status,
            startsAt: appointment.startsAt,
            endsAt: appointment.endsAt,
          },
          this.zones,
        );
        const response = { status: 200, headers: { 'Cache-Control': 'no-store' }, body };
        return { result: body, response, appointmentId: record.id };
      },
    );
    return result.response;
  }
}
