type MetricName = 'otp_decision' | 'otp_throttled' | 'outbox_retry' | 'outbox_terminal_failure';
type HistogramName = 'outbox_age_seconds' | 'outbox_delivery_latency_seconds';
export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, { count: number; sum: number; max: number }>();
  increment(name: MetricName, labels: Readonly<Record<string, string>> = {}): void {
    const key = `${name}:${Object.entries(labels)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join(',')}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }
  snapshot(): ReadonlyMap<string, number> {
    return new Map(this.counters);
  }
  observe(name: HistogramName, value: number, labels: Readonly<Record<string, string>> = {}): void {
    const key = `${name}:${Object.entries(labels)
      .sort()
      .map(([label, content]) => `${label}=${content}`)
      .join(',')}`;
    const current = this.histograms.get(key) ?? { count: 0, sum: 0, max: 0 };
    this.histograms.set(key, {
      count: current.count + 1,
      sum: current.sum + value,
      max: Math.max(current.max, value),
    });
  }
  histogramSnapshot(): ReadonlyMap<string, { count: number; sum: number; max: number }> {
    return new Map(this.histograms);
  }
}
