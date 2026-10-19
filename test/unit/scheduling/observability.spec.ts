import { randomUUID } from 'node:crypto';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { MetricReader } from '@opentelemetry/sdk-metrics';
import { describe, expect, it } from 'vitest';
import { Telemetry } from '../../../src/shared/observability/telemetry.js';
import { JsonLogger } from '../../../src/shared/observability/logger.js';
import { Metrics } from '../../../src/shared/observability/metrics.js';
import { SchedulingObservabilityService } from '../../../src/modules/scheduling/application/services/scheduling-observability.service.js';
import { SchedulingTelemetryAdapter } from '../../../src/modules/scheduling/infrastructure/observability/scheduling-telemetry.adapter.js';

class Reader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}
describe('scheduling observability', () => {
  it('does not fail a committed business operation when a telemetry exporter throws', () => {
    const observer = new SchedulingObservabilityService({
      record() {
        throw new Error('export unavailable');
      },
    });
    expect(() =>
      observer.committed(
        {
          tenantId: randomUUID(),
          actorScope: randomUUID(),
          operation: 'cancel_appointment',
          resourceScope: randomUUID(),
          key: 'private-idempotency-key',
        },
        false,
        'cancelled',
      ),
    ).not.toThrow();
  });
  it('exports bounded HTTP latency histograms, conflicts, throttles, transitions and replay without PII labels', async () => {
    const spans = new InMemorySpanExporter();
    const reader = new Reader();
    const lines: string[] = [];
    const telemetry = new Telemetry({
      logger: new JsonLogger((line) => lines.push(line)),
      spanProcessors: [new SimpleSpanProcessor(spans)],
      metricReaders: [reader],
    });
    const observer = new SchedulingObservabilityService(new SchedulingTelemetryAdapter(telemetry));
    try {
      const correlationId = randomUUID();
      for (let index = 0; index < 100; index++) {
        telemetry
          .start('scheduling_booking', { correlationId, tenantId: randomUUID() })
          .finish('accepted', 201);
        observer.committed(
          {
            tenantId: randomUUID(),
            actorScope: randomUUID(),
            operation: 'create_guest_appointment',
            resourceScope: randomUUID(),
            key: 'private-idempotency-key',
            correlationId,
          },
          false,
          'confirmed',
        );
      }
      telemetry.start('scheduling_booking', { correlationId }).finish('conflict', 409);
      telemetry.start('scheduling_availability', { correlationId }).finish('throttled', 429);
      observer.committed(
        {
          tenantId: randomUUID(),
          actorScope: randomUUID(),
          operation: 'cancel_appointment',
          resourceScope: randomUUID(),
          key: 'private-idempotency-key',
          correlationId,
        },
        true,
        'cancelled',
      );
      observer.committed(
        {
          tenantId: randomUUID(),
          actorScope: randomUUID(),
          operation: 'private@example.test',
          resourceScope: randomUUID(),
          key: 'private-idempotency-key',
          correlationId,
        },
        false,
        'confirmed',
      );
      await telemetry.forceFlush();
      const metrics = (await reader.collect()).resourceMetrics.scopeMetrics.flatMap(
        (scope) => scope.metrics,
      );
      expect(
        metrics.find((metric) => metric.descriptor.name === 'scheduling_transition')?.dataPoints,
      ).toHaveLength(1);
      expect(
        metrics.find((metric) => metric.descriptor.name === 'scheduling_transition')?.dataPoints[0],
      ).toMatchObject({ value: 100, attributes: { operation: 'booking', outcome: 'created' } });
      expect(
        metrics.find((metric) => metric.descriptor.name === 'scheduling_replay')?.dataPoints[0],
      ).toMatchObject({ value: 1, attributes: { operation: 'cancel', outcome: 'replayed' } });
      expect(
        metrics.find((metric) => metric.descriptor.name === 'scheduling_conflict')?.dataPoints[0],
      ).toMatchObject({ value: 1 });
      expect(
        metrics.find((metric) => metric.descriptor.name === 'scheduling_throttled')?.dataPoints[0],
      ).toMatchObject({ value: 1 });
      const hist = metrics.find(
        (metric) => metric.descriptor.name === 'scheduling_request_duration_seconds',
      );
      expect(hist?.dataPoints).toHaveLength(3);
      for (const metric of metrics)
        for (const point of metric.dataPoints)
          expect(
            Object.keys(point.attributes).every((key) => key === 'operation' || key === 'outcome'),
          ).toBe(true);
      const serialized = JSON.stringify({
        spans: spans
          .getFinishedSpans()
          .map((span) => ({ name: span.name, attributes: span.attributes })),
        lines,
        metrics,
      });
      expect(serialized).not.toContain('private@example.test');
      expect(serialized).not.toContain('private-idempotency-key');
      expect(
        spans.getFinishedSpans().every((span) => span.attributes.correlation_id === correlationId),
      ).toBe(true);
    } finally {
      await telemetry.onModuleDestroy();
    }
  });
  it('uses fixed histogram buckets to estimate p95 without retaining samples', () => {
    const metrics = new Metrics();
    for (let value = 1; value <= 100; value++)
      metrics.observe('scheduling_request_duration_seconds', value / 1000, {
        operation: 'scheduling_booking',
        outcome: 'accepted',
      });
    expect(
      metrics
        .histogramSnapshot()
        .get('scheduling_request_duration_seconds:scheduling_booking:accepted'),
    ).toMatchObject({ count: 100, p95: 0.1, max: 0.1 });
  });
  it('drops untrusted operation names and correlation values from spans and logs', async () => {
    const spans = new InMemorySpanExporter();
    const lines: string[] = [];
    const privateValue =
      'Pessoa Privada +5511999999999 private@example.test 203.0.113.9 private-key';
    const telemetry = new Telemetry({
      logger: new JsonLogger((line) => lines.push(line)),
      spanProcessors: [new SimpleSpanProcessor(spans)],
    });
    try {
      telemetry
        .start(privateValue as never, { correlationId: privateValue, tenantId: privateValue })
        .finish('accepted', 200);
      await telemetry.forceFlush();
      expect(
        JSON.stringify({
          lines,
          spans: spans
            .getFinishedSpans()
            .map((span) => ({ name: span.name, attributes: span.attributes })),
        }),
      ).not.toContain(privateValue);
    } finally {
      await telemetry.onModuleDestroy();
    }
  });
});
