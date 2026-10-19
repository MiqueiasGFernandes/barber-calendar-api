import type { AppointmentMutationInput } from '../ports/appointment-management.js';
import type { AppointmentLifecycleService } from '../services/appointment-lifecycle.service.js';

export class RecordAppointmentOutcomeUseCase {
  constructor(private readonly lifecycle: AppointmentLifecycleService) {}
  execute(input: AppointmentMutationInput & { status: 'attended' | 'no_show' }) {
    return this.lifecycle.execute(input, { kind: 'outcome', status: input.status });
  }
}
