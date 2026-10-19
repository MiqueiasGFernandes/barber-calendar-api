import {
  telemetryOperations,
  telemetryOutcomes,
  type TelemetryOperation,
  type TelemetryOutcome,
} from './metrics.js';
import { errorDiagnostic } from './error-diagnostics.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const traceIdPattern = /^[0-9a-f]{32}$/i;
const spanIdPattern = /^[0-9a-f]{16}$/i;
const operations = new Set<TelemetryOperation>(telemetryOperations);
const outcomes = new Set<TelemetryOutcome>(telemetryOutcomes);
const events = new Set([
  'http_request_completed',
  'outbox_delivery_completed',
  'outbox_dispatch_failed',
  'throttle_retention_completed',
  'throttle_retention_failed',
  'worker_iteration_failed',
  'telemetry_export_failed',
  'application_start_failed',
  'outbox_poll_completed',
  'operation_completed',
  'http_request_failed',
]);
type SafeLogContext = Readonly<{
  correlation_id?: unknown;
  trace_id?: unknown;
  span_id?: unknown;
  tenant_id?: unknown;
  operation?: unknown;
  outcome?: unknown;
  status_code?: unknown;
  duration_ms?: unknown;
  item_count?: unknown;
  stage?: unknown;
  component?: unknown;
}>;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => [
      key,
      /authorization|cookie|token|secret|password|otp|code|email|ip|envelope|payload|body|header|error|url|address|name|phone|idempotency|encryption|ciphertext/i.test(
        key,
      )
        ? '[REDACTED]'
        : redact(item),
    ]);
    return Object.fromEntries(entries);
  }
  return value;
}

export class JsonLogger {
  constructor(
    private readonly sink: (line: string) => void = (line) => process.stdout.write(line),
  ) {}

  log(level: string, message: string, context: SafeLogContext = {}): void {
    this.sink(`${JSON.stringify(this.record(level, message, context))}\n`);
  }

  logError(message: string, error: unknown, context: SafeLogContext = {}): void {
    this.sink(
      `${JSON.stringify({ ...this.record('error', message, context), error: errorDiagnostic(error) })}\n`,
    );
  }

  private record(
    level: string,
    message: string,
    context: SafeLogContext,
  ): Record<string, string | number> {
    const safeLevel = level === 'error' || level === 'warn' ? level : 'info';
    const safeMessage = events.has(message) ? message : 'event';
    const record: Record<string, string | number> = {
      timestamp: new Date().toISOString(),
      level: safeLevel,
      message: safeMessage,
    };
    if (typeof context.correlation_id === 'string' && uuidPattern.test(context.correlation_id))
      record.correlation_id = context.correlation_id;
    if (typeof context.trace_id === 'string' && traceIdPattern.test(context.trace_id))
      record.trace_id = context.trace_id;
    if (typeof context.span_id === 'string' && spanIdPattern.test(context.span_id))
      record.span_id = context.span_id;
    if (typeof context.tenant_id === 'string' && uuidPattern.test(context.tenant_id))
      record.tenant_id = context.tenant_id;
    if (
      typeof context.operation === 'string' &&
      operations.has(context.operation as TelemetryOperation)
    )
      record.operation = context.operation;
    if (typeof context.outcome === 'string' && outcomes.has(context.outcome as TelemetryOutcome))
      record.outcome = context.outcome;
    if (typeof context.status_code === 'number' && Number.isInteger(context.status_code))
      record.status_code = context.status_code;
    if (typeof context.duration_ms === 'number' && Number.isFinite(context.duration_ms))
      record.duration_ms = Math.max(0, context.duration_ms);
    if (typeof context.item_count === 'number' && Number.isInteger(context.item_count))
      record.item_count = Math.max(0, context.item_count);
    if (
      typeof context.stage === 'string' &&
      [
        'configuration',
        'initialization',
        'http_setup',
        'listening',
        'request',
        'worker_iteration',
      ].includes(context.stage)
    )
      record.stage = context.stage;
    if (context.component === 'api' || context.component === 'worker')
      record.component = context.component;
    return record;
  }
}
