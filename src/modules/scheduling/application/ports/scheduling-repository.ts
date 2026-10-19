import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type { AvailabilityProfessional } from '../../domain/availability.js';

export interface PublicProfessional { id: string; display_name: string; }
export interface PublicService { id: string; name: string; duration_minutes: number; price_minor: number; currency_code: string; professionals: PublicProfessional[]; }
export interface PublicCatalogPort {
  tenantId(slug: string): Promise<string>;
  listServices(slug: string): Promise<PublicService[]>;
  findService(tenantId: string, serviceId: string): Promise<PublicService | null>;
}
export interface AvailabilitySnapshot { tenantId: string; timeZone: string; slotIntervalMinutes: number; minimumAdvanceMinutes: number; service: PublicService; professionals: AvailabilityProfessional[]; }
export interface AvailabilityPort {
  load(tenantId: string, serviceId: string, date: string): Promise<AvailabilitySnapshot | null>;
  loadInTransaction(context: TransactionContext, tenantId: string, serviceId: string, date: string, excludeAppointmentId?:string): Promise<AvailabilitySnapshot | null>;
}

export interface AppointmentRecord {
  id: string;
  tenantId: string;
  professionalId: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  status: 'confirmed' | 'cancelled' | 'attended' | 'no_show';
}

export interface SchedulingRepository {
  findAppointment(transaction: TransactionContext, tenantId: string, appointmentId: string): Promise<AppointmentRecord | null>;
  findConfirmedOverlap(transaction: TransactionContext, input: { tenantId: string; professionalId: string; startsAt: Date; endsAt: Date; excludeAppointmentId?: string }): Promise<string | null>;
}
