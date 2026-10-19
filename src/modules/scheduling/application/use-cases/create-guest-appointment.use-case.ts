import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../../../shared/application/application-error.js';
import type { AppointmentEventWriter, AppointmentWriter } from '../ports/appointment-writer.js';
import type { AvailabilityPort, PublicCatalogPort } from '../ports/scheduling-repository.js';
import type { IdempotentMutationService } from '../services/idempotent-mutation.service.js';
import type { TimeZoneConverter } from '../ports/time-zone.js';
import { Appointment } from '../../domain/appointment.js';
import { availableSlots } from '../../domain/availability.js';

export interface GuestAppointmentInput {
  tenantSlug: string;
  serviceId: string;
  professionalId?: string | null;
  startsAt: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  idempotencyKey: string;
}

export class CreateGuestAppointmentUseCase {
  constructor(
    private readonly catalog: PublicCatalogPort,
    private readonly availability: AvailabilityPort,
    private readonly zones: TimeZoneConverter,
    private readonly idempotency: IdempotentMutationService,
    private readonly appointments: AppointmentWriter,
    private readonly events: AppointmentEventWriter,
  ) {}

  async execute(input: GuestAppointmentInput): Promise<{ status: number; headers: Record<string, string>; body: Record<string, unknown> }> {
    const tenantId = await this.catalog.tenantId(input.tenantSlug);
    const requestedStart = new Date(input.startsAt);
    if (!Number.isFinite(requestedStart.getTime())) throw new ApplicationError(422, 'validation_error', 'Invalid appointment start');
    const scope = {
      tenantId,
      actorScope: 'public',
      operation: 'create_guest_appointment',
      resourceScope: 'tenant',
      key: input.idempotencyKey,
    };
    const request = {
      service_id: input.serviceId,
      professional_id: input.professionalId ?? null,
      starts_at: requestedStart.toISOString(),
      guest_name: input.guestName,
      guest_phone: input.guestPhone,
      guest_email: input.guestEmail,
    };
    const outcome = await this.idempotency.execute(tenantId, scope, request, async (context, now) => {
      const settings = await context.query<{ time_zone: string }>(
        'SELECT t.time_zone FROM tenancy.tenants t JOIN scheduling.tenant_settings s ON s.tenant_id=t.id WHERE t.id=$1',
        [tenantId],
      );
      const timeZone = settings.rows[0]?.time_zone;
      if (!timeZone) throw new ApplicationError(404, 'not_found', 'Tenant not found');
      const localDate = this.zones.instantToLocalDateTime(requestedStart, timeZone).slice(0, 10);
      const snapshot = await this.availability.loadInTransaction(context, tenantId, input.serviceId, localDate);
      if (!snapshot) throw new ApplicationError(404, 'not_found', 'Service not found');
      const slot = availableSlots({
        date: localDate,
        now,
        timeZone: snapshot.timeZone,
        slotIntervalMinutes: snapshot.slotIntervalMinutes,
        minimumAdvanceMinutes: snapshot.minimumAdvanceMinutes,
        durationMinutes: snapshot.service.duration_minutes,
        professionals: snapshot.professionals,
        converter: this.zones,
        ...(input.professionalId ? { selectedProfessionalId: input.professionalId } : {}),
      }).find((candidate) => candidate.startsAt.getTime() === requestedStart.getTime());
      if (!slot) throw new ApplicationError(409, 'slot_conflict', 'The requested time is no longer available');
      const professional = snapshot.service.professionals.find((item) => item.id === slot.professionalId);
      if (!professional) throw new ApplicationError(409, 'slot_conflict', 'No eligible professional is available');
      const appointmentId = randomUUID();
      const publicId = randomUUID();
      const appointment = new Appointment({
        id: appointmentId,
        publicId,
        tenantId,
        professionalId: slot.professionalId,
        serviceId: snapshot.service.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        customerName: input.guestName,
        customerPhone: input.guestPhone,
        customerEmail: input.guestEmail,
        serviceName: snapshot.service.name,
        durationMinutes: snapshot.service.duration_minutes,
        priceMinor: snapshot.service.price_minor,
        currency: snapshot.service.currency_code,
      });
      await this.appointments.create(context, appointment, now);
      await this.events.append(context, {
        id: randomUUID(), tenantId, appointmentId, eventType: 'created', actorMembershipId: null,
        occurredAt: now, correlationId: randomUUID(), previousStatus: null, newStatus: 'confirmed',
        previousStartsAt: null, previousEndsAt: null, startsAt: slot.startsAt, endsAt: slot.endsAt,
      });
      const body = {
        id: publicId,
        status: 'confirmed',
        service_name: snapshot.service.name,
        professional_name: professional.display_name,
        starts_at: this.zones.instantToOffsetDateTime(slot.startsAt, timeZone),
        ends_at: this.zones.instantToOffsetDateTime(slot.endsAt, timeZone),
      };
      const response = { status: 201, headers: {}, body };
      return { result: response, response, appointmentId };
    });
    return outcome.response as { status: number; headers: Record<string, string>; body: Record<string, unknown> };
  }
}
