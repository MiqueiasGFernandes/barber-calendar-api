import { randomUUID } from 'node:crypto';
import type { Telemetry } from '../../../../shared/observability/telemetry.js';
import type {
  SchedulingMutationSignal,
  SchedulingTelemetryPort,
} from '../../application/ports/scheduling-telemetry.js';

export class SchedulingTelemetryAdapter implements SchedulingTelemetryPort {
  constructor(private readonly telemetry: Telemetry) {}
  record(signal: SchedulingMutationSignal): void {
    this.telemetry.schedulingMutation(signal.operation, signal.outcome, {
      tenantId: signal.tenantId,
      correlationId: signal.correlationId ?? randomUUID(),
    });
  }
}
