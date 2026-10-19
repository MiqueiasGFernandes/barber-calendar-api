import type { AppointmentMutationInput } from '../ports/appointment-management.js';
import type { AppointmentLifecycleService } from '../services/appointment-lifecycle.service.js';

export class RescheduleAppointmentUseCase {
  constructor(private readonly lifecycle: AppointmentLifecycleService) {}
  execute(input: AppointmentMutationInput & { startsAt: string }) {
    return this.lifecycle.execute(input, { kind: 'reschedule', startsAt: input.startsAt });
  }
}
