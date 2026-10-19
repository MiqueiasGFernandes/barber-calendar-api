import type { AppointmentMutationInput } from '../ports/appointment-management.js';
import type { AppointmentLifecycleService } from '../services/appointment-lifecycle.service.js';

export class CancelAppointmentUseCase {
  constructor(private readonly lifecycle: AppointmentLifecycleService) {}
  execute(input: AppointmentMutationInput) {
    return this.lifecycle.execute(input, { kind: 'cancel' });
  }
}
