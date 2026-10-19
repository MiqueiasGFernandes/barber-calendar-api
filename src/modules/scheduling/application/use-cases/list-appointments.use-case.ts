import { ApplicationError } from '../../../../shared/application/application-error.js';
import type { AppointmentFilters, AppointmentQueryPort } from '../ports/appointment-management.js';

export class ListAppointmentsUseCase {
  constructor(private readonly appointments: AppointmentQueryPort) {}
  async execute(tenantId: string, filters: AppointmentFilters) {
    if (
      !Number.isFinite(filters.startsFrom.getTime()) ||
      !Number.isFinite(filters.endsBefore.getTime()) ||
      filters.endsBefore <= filters.startsFrom
    )
      throw new ApplicationError(422, 'validation_error', 'Invalid appointment period');
    return { appointments: await this.appointments.list(tenantId, filters) };
  }
}
