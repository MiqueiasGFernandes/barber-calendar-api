export const schedulingHttpOperations = [
  'scheduling_catalog',
  'scheduling_availability',
  'scheduling_booking',
  'scheduling_configuration',
  'scheduling_agenda',
  'scheduling_cancel',
  'scheduling_reschedule',
  'scheduling_outcome',
] as const;
export type SchedulingHttpOperation = (typeof schedulingHttpOperations)[number];
export const telemetryOperations = [
  'registration',
  'otp_request',
  'otp_verification',
  'http_other',
  'outbox_poll',
  'outbox_delivery',
  'throttle_retention',
  'scheduling_mutation',
  ...schedulingHttpOperations,
] as const;
export type TelemetryOperation = (typeof telemetryOperations)[number];
export const telemetryOutcomes = [
  'accepted',
  'rejected',
  'throttled',
  'succeeded',
  'failed',
  'delivered',
  'retry',
  'expired',
  'terminal_failure',
  'conflict',
  'replayed',
  'created',
  'cancelled',
  'rescheduled',
  'attended',
  'no_show',
  'committed',
] as const;
export type TelemetryOutcome = (typeof telemetryOutcomes)[number];
export type SchedulingMutationOperation =
  'booking' | 'configuration' | 'cancel' | 'reschedule' | 'outcome';
export type SchedulingMutationOutcome =
  'replayed' | 'created' | 'cancelled' | 'rescheduled' | 'attended' | 'no_show' | 'committed';
export type HistogramName =
  'outbox_age_seconds' | 'outbox_delivery_latency_seconds' | 'scheduling_request_duration_seconds';
export type CounterName =
  | 'otp_decision'
  | 'otp_throttled'
  | 'outbox_retry'
  | 'outbox_terminal_failure'
  | 'scheduling_request'
  | 'scheduling_conflict'
  | 'scheduling_throttled'
  | 'scheduling_replay'
  | 'scheduling_transition';
export interface MetricLabels {
  operation?: TelemetryOperation | SchedulingMutationOperation;
  outcome?: TelemetryOutcome;
}
export const latencyBuckets = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30,
] as const;
interface Histogram {
  count: number;
  sum: number;
  max: number;
  buckets: number[];
}
export interface HistogramSnapshot {
  count: number;
  sum: number;
  max: number;
  p95: number;
}
const operations = new Set<string>([
  ...telemetryOperations,
  'booking',
  'configuration',
  'cancel',
  'reschedule',
  'outcome',
]);
const outcomes = new Set<string>(telemetryOutcomes);
function labelKey(labels: Readonly<MetricLabels>): string {
  const operation =
    labels.operation && operations.has(labels.operation) ? labels.operation : 'none';
  const outcome = labels.outcome && outcomes.has(labels.outcome) ? labels.outcome : 'none';
  return `${operation}:${outcome}`;
}

/** Fixed dimensions and buckets keep diagnostic storage bounded; OTLP exports cumulative histograms. */
export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, Histogram>();
  increment(name: CounterName, labels: Readonly<MetricLabels> = {}): void {
    const key = `${name}:${labelKey(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }
  snapshot(): ReadonlyMap<string, number> {
    return new Map(this.counters);
  }
  observe(name: HistogramName, value: number, labels: Readonly<MetricLabels> = {}): void {
    if (!Number.isFinite(value) || value < 0) return;
    const key =
      name === 'scheduling_request_duration_seconds' ? `${name}:${labelKey(labels)}` : name;
    const current = this.histograms.get(key) ?? {
      count: 0,
      sum: 0,
      max: 0,
      buckets: Array<number>(latencyBuckets.length + 1).fill(0),
    };
    const found = latencyBuckets.findIndex((boundary) => value <= boundary);
    const index = found < 0 ? latencyBuckets.length : found;
    current.count++;
    current.sum += value;
    current.max = Math.max(current.max, value);
    current.buckets[index] = (current.buckets[index] ?? 0) + 1;
    this.histograms.set(key, current);
  }
  histogramSnapshot(): ReadonlyMap<string, HistogramSnapshot> {
    return new Map(
      [...this.histograms].map(([key, value]) => {
        let total = 0;
        let p95 = value.max;
        for (let index = 0; index < value.buckets.length; index++) {
          total += value.buckets[index] ?? 0;
          if (total >= Math.ceil(value.count * 0.95)) {
            p95 = latencyBuckets[index] ?? value.max;
            break;
          }
        }
        return [key, { count: value.count, sum: value.sum, max: value.max, p95 }];
      }),
    );
  }
}
