import { randomUUID } from 'node:crypto';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { MetricReader } from '@opentelemetry/sdk-metrics';
import { describe, expect, it } from 'vitest';
import { JsonLogger } from '../../src/shared/observability/logger.js';
import { Telemetry } from '../../src/shared/observability/telemetry.js';

class TestMetricReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

describe('telemetria com campos permitidos', () => {
  it('exporta spans, métricas limitadas e logs correlacionados sem contexto livre', async () => {
    const lines: string[] = [];
    const exporter = new InMemorySpanExporter();
    const reader = new TestMetricReader();
    const telemetry = new Telemetry({
      logger: new JsonLogger((line) => lines.push(line)),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
      metricReaders: [reader],
    });
    try {
      const correlationId = randomUUID();
      for (let i = 0; i < 100; i++) {
        const operation = telemetry.start('otp_verification', {
          correlationId,
          tenantId: randomUUID(),
        });
        operation.finish('rejected');
        operation.finish('rejected'); // repeated completion must not double count
      }
      await telemetry.forceFlush();
      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(100);
      expect(spans[0]?.attributes.correlation_id).toBe(correlationId);
      expect(lines).toHaveLength(100);
      expect(JSON.parse(lines.at(0) ?? '{}')).toMatchObject({
        correlation_id: correlationId,
        trace_id: spans[0]?.spanContext().traceId,
        span_id: spans[0]?.spanContext().spanId,
        operation: 'otp_verification',
        outcome: 'rejected',
      });
      const metrics = (await reader.collect()).resourceMetrics.scopeMetrics.flatMap(
        (s) => s.metrics,
      );
      const decisions = metrics.find((metric) => metric.descriptor.name === 'otp_decision');
      expect(decisions?.dataPoints).toHaveLength(1);
      expect(decisions?.dataPoints[0]).toMatchObject({
        value: 100,
        attributes: { operation: 'otp_verification', outcome: 'rejected' },
      });
    } finally {
      await telemetry.onModuleDestroy();
    }
  });

  it('descarta valores livres, aliases e erros mesmo em campos inesperados', async () => {
    const secret = 'private@example.test 203.0.113.8 654321 Bearer secret-jwt decrypted-envelope';
    const lines: string[] = [];
    const logger = new JsonLogger((line) => lines.push(line));
    logger.log('error', 'operation_completed', {
      correlation_id: secret,
      trace_id: secret,
      tenant_id: secret,
      operation: secret,
      outcome: secret,
      message: secret,
      nested: { accessToken: secret },
      error: new Error(secret),
      url: secret,
      envelope: Buffer.from(secret),
    } as never);
    expect(lines.join('')).not.toContain(secret);
    expect(JSON.parse(lines.at(0) ?? '{}')).toEqual({
      timestamp: expect.any(String),
      level: 'error',
      message: 'operation_completed',
    });
  });
});
