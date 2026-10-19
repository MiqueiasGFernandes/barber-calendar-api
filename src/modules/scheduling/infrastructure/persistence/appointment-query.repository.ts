import type { Queryable } from '../../../../shared/database/postgres-pool.js';
import type {
  AppointmentFilters,
  AppointmentQueryPort,
  ManagedAppointment,
} from '../../application/ports/appointment-management.js';
import type { TimeZoneConverter } from '../../application/ports/time-zone.js';
import { managedAppointment } from '../../application/services/managed-appointment.js';
import {
  appointmentDetails,
  appointmentSelection,
  type AppointmentRow,
} from './appointment-management.mapping.js';

export class AppointmentQueryRepository implements AppointmentQueryPort {
  constructor(
    private readonly database: Queryable,
    private readonly zones: TimeZoneConverter,
  ) {}
  async list(tenantId: string, filters: AppointmentFilters): Promise<ManagedAppointment[]> {
    const result = await this.database.query<AppointmentRow>(
      `${appointmentSelection}
      WHERE a.tenant_id=$1 AND a.starts_at<$3 AND a.ends_at>$2
      AND ($4::uuid IS NULL OR a.professional_id=$4) AND ($5::text IS NULL OR a.status=$5)
      ORDER BY a.starts_at,a.id`,
      [
        tenantId,
        filters.startsFrom,
        filters.endsBefore,
        filters.professionalId ?? null,
        filters.status ?? null,
      ],
    );
    return result.rows.map((row) => managedAppointment(appointmentDetails(row), this.zones));
  }
}
