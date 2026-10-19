import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type { Appointment } from '../../domain/appointment.js';

export interface AppointmentWriter {
  create(context: TransactionContext, appointment: Appointment, now: Date): Promise<void>;
}

export interface AppointmentEventInput {
  id: string; tenantId: string; appointmentId: string;
  eventType: 'created' | 'rescheduled' | 'cancelled' | 'attended' | 'no_show';
  actorMembershipId: string | null; occurredAt: Date; correlationId: string;
  previousStatus: 'confirmed' | 'cancelled' | 'attended' | 'no_show' | null;
  newStatus: 'confirmed' | 'cancelled' | 'attended' | 'no_show';
  previousStartsAt: Date | null; previousEndsAt: Date | null; startsAt: Date; endsAt: Date;
}

export interface AppointmentEventWriter {
  append(context: TransactionContext, event: AppointmentEventInput): Promise<void>;
}
