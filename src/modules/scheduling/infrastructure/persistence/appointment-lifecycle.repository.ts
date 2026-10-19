import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type { Queryable } from '../../../../shared/database/postgres-pool.js';
import type {
  AppointmentLifecyclePort,
  AppointmentDetails,
} from '../../application/ports/appointment-management.js';
import type { Appointment } from '../../domain/appointment.js';
import {
  appointmentDetails,
  appointmentSelection,
  type AppointmentRow,
} from './appointment-management.mapping.js';

export class AppointmentLifecycleRepository implements AppointmentLifecyclePort {
  constructor(private readonly database: Queryable) {}
  async resolveId(tenantId: string, identifier: string): Promise<string | null> {
    const result = await this.database.query<{ id: string }>(
      `SELECT id FROM scheduling.appointments WHERE tenant_id=$1 AND (id=$2 OR public_id=$2) ORDER BY CASE WHEN id=$2 THEN 0 ELSE 1 END LIMIT 1`,
      [tenantId, identifier],
    );
    return result.rows[0]?.id ?? null;
  }
  async findForUpdate(
    context: TransactionContext,
    tenantId: string,
    appointmentId: string,
  ): Promise<AppointmentDetails | null> {
    const result = await context.query<AppointmentRow>(
      `${appointmentSelection} WHERE a.tenant_id=$1 AND a.id=$2 ORDER BY a.id FOR UPDATE OF a`,
      [tenantId, appointmentId],
    );
    const row = result.rows[0];
    return row ? appointmentDetails(row) : null;
  }
  async saveConfirmed(
    context: TransactionContext,
    appointment: Appointment,
    now: Date,
  ): Promise<boolean> {
    const result = await context.query(
      `UPDATE scheduling.appointments SET status=$3,starts_at=$4,ends_at=$5,updated_at=$6
      WHERE tenant_id=$1 AND id=$2 AND status='confirmed'`,
      [
        appointment.input.tenantId,
        appointment.input.id,
        appointment.status,
        appointment.startsAt,
        appointment.endsAt,
        now,
      ],
    );
    return result.rowCount === 1;
  }
}
