import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';

export interface AppointmentEventInput {
  id: string; tenantId: string; appointmentId: string;
  eventType: 'created' | 'rescheduled' | 'cancelled' | 'attended' | 'no_show';
  actorMembershipId: string | null; occurredAt: Date; correlationId: string;
  previousStatus: 'confirmed' | 'cancelled' | 'attended' | 'no_show' | null;
  newStatus: 'confirmed' | 'cancelled' | 'attended' | 'no_show';
  previousStartsAt: Date | null; previousEndsAt: Date | null; startsAt: Date; endsAt: Date;
}

export class AppointmentEventRepository {
  async append(context: TransactionContext, event: AppointmentEventInput): Promise<void> {
    if (event.eventType !== 'created' && event.actorMembershipId === null)
      throw new Error('only public creation may have a null actor');
    await context.query(
      `INSERT INTO scheduling.appointment_events(id,tenant_id,appointment_id,event_type,actor_membership_id,occurred_at,correlation_id,previous_status,new_status,previous_starts_at,previous_ends_at,starts_at,ends_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [event.id,event.tenantId,event.appointmentId,event.eventType,event.actorMembershipId,event.occurredAt,event.correlationId,event.previousStatus,event.newStatus,event.previousStartsAt,event.previousEndsAt,event.startsAt,event.endsAt],
    );
  }
}
