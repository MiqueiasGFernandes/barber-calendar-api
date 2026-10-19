import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type { Appointment, AppointmentInput, AppointmentStatus } from '../../domain/appointment.js';

export interface ManagedAppointment {
  id: string;
  status: AppointmentStatus;
  service_id: string;
  service_name: string;
  professional_id: string;
  professional_name: string;
  starts_at: string;
  ends_at: string;
  guest_name: string;
  guest_phone: string;
  guest_email: string;
}
export interface AppointmentDetails extends AppointmentInput {
  status: AppointmentStatus;
  professionalName: string;
  timeZone: string;
}
export interface AppointmentFilters {
  startsFrom: Date;
  endsBefore: Date;
  professionalId?: string;
  status?: AppointmentStatus;
}
export interface AppointmentQueryPort {
  list(tenantId: string, filters: AppointmentFilters): Promise<ManagedAppointment[]>;
}
export interface AppointmentLifecyclePort {
  resolveId(tenantId: string, identifier: string): Promise<string | null>;
  findForUpdate(
    context: TransactionContext,
    tenantId: string,
    appointmentId: string,
  ): Promise<AppointmentDetails | null>;
  saveConfirmed(context: TransactionContext, appointment: Appointment, now: Date): Promise<boolean>;
}
export interface AppointmentMutationInput {
  tenantId: string;
  membershipId: string;
  appointmentId: string;
  idempotencyKey: string;
  correlationId: string;
}
export type AppointmentCommand =
  | { kind: 'cancel' }
  | { kind: 'reschedule'; startsAt: string }
  | { kind: 'outcome'; status: 'attended' | 'no_show' };
