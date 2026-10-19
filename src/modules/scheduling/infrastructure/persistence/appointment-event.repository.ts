import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type { AppointmentEventInput, AppointmentEventWriter } from '../../application/ports/appointment-writer.js';

export type { AppointmentEventInput } from '../../application/ports/appointment-writer.js';
export class AppointmentEventRepository implements AppointmentEventWriter {
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
