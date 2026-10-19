import type { AppointmentStatus } from '../../domain/appointment.js';
import type { AppointmentDetails } from '../../application/ports/appointment-management.js';

export interface AppointmentRow {
  id: string;
  public_id: string;
  tenant_id: string;
  professional_id: string;
  service_id: string;
  status: AppointmentStatus;
  starts_at: Date;
  ends_at: Date;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  service_name_snapshot: string;
  duration_minutes_snapshot: number;
  price_minor_snapshot: number;
  currency_snapshot: string;
  professional_name: string;
  time_zone: string;
}
export const appointmentSelection = `SELECT a.*,p.name AS professional_name,t.time_zone
  FROM scheduling.appointments a
  JOIN scheduling.professionals p ON p.tenant_id=a.tenant_id AND p.id=a.professional_id
  JOIN tenancy.tenants t ON t.id=a.tenant_id`;
export function appointmentDetails(row: AppointmentRow): AppointmentDetails {
  return {
    id: row.id,
    publicId: row.public_id,
    tenantId: row.tenant_id,
    professionalId: row.professional_id,
    serviceId: row.service_id,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    serviceName: row.service_name_snapshot,
    durationMinutes: row.duration_minutes_snapshot,
    priceMinor: row.price_minor_snapshot,
    currency: row.currency_snapshot,
    professionalName: row.professional_name,
    timeZone: row.time_zone,
  };
}
