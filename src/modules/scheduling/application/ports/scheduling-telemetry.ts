export interface SchedulingMutationSignal {
  operation: 'booking' | 'configuration' | 'cancel' | 'reschedule' | 'outcome';
  outcome:
    'replayed' | 'created' | 'cancelled' | 'rescheduled' | 'attended' | 'no_show' | 'committed';
  tenantId: string;
  correlationId?: string;
}
export interface SchedulingTelemetryPort {
  record(signal: SchedulingMutationSignal): void;
}
