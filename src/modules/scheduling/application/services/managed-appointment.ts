import type { AppointmentDetails, ManagedAppointment } from '../ports/appointment-management.js';
import type { TimeZoneConverter } from '../ports/time-zone.js';

export function managedAppointment(
  record: AppointmentDetails,
  zones: TimeZoneConverter,
): ManagedAppointment {
  return {
    id: record.id,
    status: record.status,
    service_id: record.serviceId,
    service_name: record.serviceName,
    professional_id: record.professionalId,
    professional_name: record.professionalName,
    starts_at: zones.instantToOffsetDateTime(record.startsAt, record.timeZone),
    ends_at: zones.instantToOffsetDateTime(record.endsAt, record.timeZone),
    guest_name: record.customerName,
    guest_phone: record.customerPhone,
    guest_email: record.customerEmail,
  };
}
