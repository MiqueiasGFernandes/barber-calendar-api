export type TelemetryOperation =
  | 'registration'
  | 'otp_request'
  | 'otp_verification'
  | 'http_other'
  | 'outbox_poll'
  | 'outbox_delivery'
  | 'throttle_retention';
export type TelemetryOutcome =
  | 'accepted'
  | 'rejected'
  | 'throttled'
  | 'succeeded'
  | 'failed'
  | 'delivered'
  | 'retry'
  | 'expired'
  | 'terminal_failure';
export type HistogramName = 'outbox_age_seconds' | 'outbox_delivery_latency_seconds';

/** In-process bounded metrics, retained for diagnostics and mirrored to OpenTelemetry. */
export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, { count: number; sum: number; max: number }>();

  increment(
    name: 'otp_decision' | 'otp_throttled' | 'outbox_retry' | 'outbox_terminal_failure',
    labels: Readonly<{ operation?: TelemetryOperation; outcome?: TelemetryOutcome }> = {},
  ): void {
    const key = `${name}:${labels.operation ?? 'none'}:${labels.outcome ?? 'none'}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  snapshot(): ReadonlyMap<string, number> {
    return new Map(this.counters);
  }

  observe(name: HistogramName, value: number): void {
    const current = this.histograms.get(name) ?? { count: 0, sum: 0, max: 0 };
    this.histograms.set(name, {
      count: current.count + 1,
      sum: current.sum + value,
      max: Math.max(current.max, value),
    });
  }

  histogramSnapshot(): ReadonlyMap<string, { count: number; sum: number; max: number }> {
    return new Map(this.histograms);
  }
}
