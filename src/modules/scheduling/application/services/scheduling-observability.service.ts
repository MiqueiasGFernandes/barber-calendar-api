import type { IdempotencyScope } from '../ports/idempotency-cipher.js';
import type {
  SchedulingMutationSignal,
  SchedulingTelemetryPort,
} from '../ports/scheduling-telemetry.js';

const operations: Readonly<Record<string, SchedulingMutationSignal['operation']>> = {
  create_guest_appointment: 'booking',
  cancel_appointment: 'cancel',
  reschedule_appointment: 'reschedule',
  record_appointment_outcome: 'outcome',
  updateSchedulingSettings: 'configuration',
  updateTenantTimeZone: 'configuration',
  createService: 'configuration',
  updateService: 'configuration',
  createProfessional: 'configuration',
  updateProfessional: 'configuration',
  replaceWeeklyWorkPeriods: 'configuration',
  createAvailabilityException: 'configuration',
  deleteAvailabilityException: 'configuration',
};
export class SchedulingObservabilityService {
  constructor(private readonly telemetry: SchedulingTelemetryPort) {}
  committed(scope: IdempotencyScope, replayed: boolean, status: unknown): void {
    const operation = Object.hasOwn(operations, scope.operation)
      ? operations[scope.operation]
      : undefined;
    if (!operation) return;
    let outcome: SchedulingMutationSignal['outcome'];
    if (replayed) outcome = 'replayed';
    else if (operation === 'booking') outcome = 'created';
    else if (operation === 'cancel') outcome = 'cancelled';
    else if (operation === 'reschedule') outcome = 'rescheduled';
    else if (operation === 'outcome' && (status === 'attended' || status === 'no_show'))
      outcome = status;
    else if (operation === 'configuration') outcome = 'committed';
    else return;
    // Diagnostic export must never turn a committed operation into an HTTP failure.
    try {
      this.telemetry.record({
        operation,
        outcome,
        tenantId: scope.tenantId,
        ...(scope.correlationId ? { correlationId: scope.correlationId } : {}),
      });
    } catch {
      /* telemetry is best effort */
    }
  }
}
