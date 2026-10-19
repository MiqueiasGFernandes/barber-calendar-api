import { SpanStatusCode } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type MetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  NoopSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { JsonLogger } from './logger.js';
import {
  Metrics,
  latencyBuckets,
  schedulingHttpOperations,
  telemetryOperations,
  type SchedulingMutationOperation,
  type SchedulingMutationOutcome,
  type TelemetryOperation,
  type TelemetryOutcome,
} from './metrics.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TelemetryOptions {
  logger?: JsonLogger;
  spanProcessors?: SpanProcessor[];
  metricReaders?: MetricReader[];
  tracesEndpoint?: string;
  metricsEndpoint?: string;
  serviceName?: string;
}

export interface CorrelationContext {
  correlationId: string;
  tenantId?: string;
}

export interface SpanOperation {
  finish(outcome: TelemetryOutcome, statusCode?: number): void;
  traceId(): string;
  spanId(): string;
}

export class Telemetry {
  readonly metrics = new Metrics();
  private readonly tracerProvider: BasicTracerProvider;
  private readonly meterProvider: MeterProvider;
  private readonly logger: JsonLogger;
  private readonly otpDecision;
  private readonly throttled;
  private readonly outboxRetry;
  private readonly outboxTerminalFailure;
  private readonly outboxAge;
  private readonly outboxDeliveryLatency;
  private readonly schedulingRequest;
  private readonly schedulingConflict;
  private readonly schedulingThrottled;
  private readonly schedulingReplay;
  private readonly schedulingTransition;
  private readonly schedulingLatency;

  constructor(options: TelemetryOptions = {}) {
    this.logger = options.logger ?? new JsonLogger();
    const processors =
      options.spanProcessors ??
      (options.tracesEndpoint
        ? [new BatchSpanProcessor(new OTLPTraceExporter({ url: options.tracesEndpoint }))]
        : [new NoopSpanProcessor()]);
    this.tracerProvider = new BasicTracerProvider({
      spanProcessors: processors,
      resource: resourceFromAttributes({
        'service.name': options.serviceName ?? 'barber-calendar-api',
      }),
    });
    const readers =
      options.metricReaders ??
      (options.metricsEndpoint
        ? [
            new PeriodicExportingMetricReader({
              exporter: new OTLPMetricExporter({ url: options.metricsEndpoint }),
              exportIntervalMillis: 30_000,
            }),
          ]
        : []);
    this.meterProvider = new MeterProvider({ readers });
    const meter = this.meterProvider.getMeter(options.serviceName ?? 'barber-calendar-api');
    this.otpDecision = meter.createCounter('otp_decision', {
      description: 'OTP decisions by flow and outcome',
    });
    this.throttled = meter.createCounter('otp_throttled', {
      description: 'Rate limited OTP operations',
    });
    this.outboxRetry = meter.createCounter('outbox_retry', {
      description: 'Retryable outbox deliveries',
    });
    this.outboxTerminalFailure = meter.createCounter('outbox_terminal_failure', {
      description: 'Terminal outbox failures',
    });
    this.outboxAge = meter.createHistogram('outbox_age_seconds', {
      unit: 's',
      description: 'Age of an outbox item when delivered',
    });
    this.outboxDeliveryLatency = meter.createHistogram('outbox_delivery_latency_seconds', {
      unit: 's',
      description: 'Time spent delivering an outbox item',
    });
    this.schedulingRequest = meter.createCounter('scheduling_request');
    this.schedulingConflict = meter.createCounter('scheduling_conflict');
    this.schedulingThrottled = meter.createCounter('scheduling_throttled');
    this.schedulingReplay = meter.createCounter('scheduling_replay');
    this.schedulingTransition = meter.createCounter('scheduling_transition');
    this.schedulingLatency = meter.createHistogram('scheduling_request_duration_seconds', {
      unit: 's',
      description: 'HTTP scheduling latency; aggregate buckets for p95',
      advice: { explicitBucketBoundaries: [...latencyBuckets] },
    });
  }

  start(operation: TelemetryOperation, correlation: CorrelationContext): SpanOperation {
    if (!(telemetryOperations as readonly string[]).includes(operation)) operation = 'http_other';
    const span = this.tracerProvider.getTracer('barber-calendar-api').startSpan(operation);
    span.setAttribute('operation', operation);
    if (uuidPattern.test(correlation.correlationId))
      span.setAttribute('correlation_id', correlation.correlationId);
    if (correlation.tenantId && uuidPattern.test(correlation.tenantId))
      span.setAttribute('tenant_id', correlation.tenantId);
    const startedAt = performance.now();
    let completed = false;
    return {
      traceId: () => span.spanContext().traceId,
      spanId: () => span.spanContext().spanId,
      finish: (outcome, statusCode) => {
        if (completed) return;
        completed = true;
        const durationMs = performance.now() - startedAt;
        const attributes = { operation, outcome };
        if (
          statusCode !== undefined &&
          (schedulingHttpOperations as readonly string[]).includes(operation)
        ) {
          this.schedulingRequest.add(1, attributes);
          this.metrics.increment('scheduling_request', attributes);
          this.schedulingLatency.record(durationMs / 1000, attributes);
          this.metrics.observe(
            'scheduling_request_duration_seconds',
            durationMs / 1000,
            attributes,
          );
          if (statusCode === 409) {
            this.schedulingConflict.add(1, attributes);
            this.metrics.increment('scheduling_conflict', attributes);
          }
          if (statusCode === 429) {
            this.schedulingThrottled.add(1, attributes);
            this.metrics.increment('scheduling_throttled', attributes);
          }
        }
        if (
          operation === 'registration' ||
          operation === 'otp_request' ||
          operation === 'otp_verification'
        ) {
          this.otpDecision.add(1, attributes);
          this.metrics.increment('otp_decision', attributes);
          if (outcome === 'throttled') {
            this.throttled.add(1, attributes);
            this.metrics.increment('otp_throttled', attributes);
          }
        }
        span.setAttribute('outcome', outcome);
        if (statusCode !== undefined) span.setAttribute('http.response.status_code', statusCode);
        if (outcome === 'failed' || outcome === 'terminal_failure') {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        span.end();
        this.logger.log(outcome === 'failed' ? 'error' : 'info', 'operation_completed', {
          correlation_id: correlation.correlationId,
          trace_id: span.spanContext().traceId,
          span_id: span.spanContext().spanId,
          tenant_id: correlation.tenantId,
          operation,
          outcome,
          status_code: statusCode,
          duration_ms: durationMs,
        });
      },
    };
  }

  schedulingMutation(
    operation: SchedulingMutationOperation,
    outcome: SchedulingMutationOutcome,
    correlation: CorrelationContext,
  ): void {
    if (
      !['booking', 'configuration', 'cancel', 'reschedule', 'outcome'].includes(operation) ||
      ![
        'replayed',
        'created',
        'cancelled',
        'rescheduled',
        'attended',
        'no_show',
        'committed',
      ].includes(outcome)
    )
      return;
    const attributes = { operation, outcome };
    if (outcome === 'replayed') {
      this.schedulingReplay.add(1, attributes);
      this.metrics.increment('scheduling_replay', attributes);
    } else if (outcome !== 'committed') {
      this.schedulingTransition.add(1, attributes);
      this.metrics.increment('scheduling_transition', attributes);
    }
    this.start('scheduling_mutation', correlation).finish(outcome);
  }

  outbox(
    correlation: CorrelationContext,
    outcome: 'delivered' | 'retry' | 'expired' | 'terminal_failure',
    ageSeconds: number,
    durationSeconds: number,
  ): void {
    const operation = this.start('outbox_delivery', correlation);
    const attributes = { operation: 'outbox_delivery' as const, outcome };
    this.outboxAge.record(Math.max(0, ageSeconds), { outcome });
    this.metrics.observe('outbox_age_seconds', Math.max(0, ageSeconds));
    if (outcome === 'delivered') {
      this.outboxDeliveryLatency.record(Math.max(0, durationSeconds), { outcome });
      this.metrics.observe('outbox_delivery_latency_seconds', Math.max(0, durationSeconds));
    } else if (outcome === 'retry') {
      this.outboxRetry.add(1, attributes);
      this.metrics.increment('outbox_retry', attributes);
    } else if (outcome === 'terminal_failure') {
      this.outboxTerminalFailure.add(1, attributes);
      this.metrics.increment('outbox_terminal_failure', attributes);
    }
    operation.finish(outcome);
  }

  async forceFlush(): Promise<void> {
    await Promise.all([this.tracerProvider.forceFlush(), this.meterProvider.forceFlush()]);
  }

  log(level: string, event: string, context: Parameters<JsonLogger['log']>[2] = {}): void {
    this.logger.log(level, event, context);
  }

  logError(
    event: string,
    error: unknown,
    context: Parameters<JsonLogger['logError']>[2] = {},
  ): void {
    this.logger.logError(event, error, context);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.tracerProvider.shutdown(), this.meterProvider.shutdown()]);
  }
}
