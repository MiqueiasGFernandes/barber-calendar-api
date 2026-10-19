import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { Http2ServerRequest } from 'node:http2';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Telemetry, SpanOperation } from '../observability/telemetry.js';
import type { TelemetryOperation, TelemetryOutcome } from '../observability/metrics.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizedCorrelationId(headers: IncomingHttpHeaders): string {
  const value = headers['x-correlation-id'];
  return typeof value === 'string' && uuidPattern.test(value) ? value.toLowerCase() : randomUUID();
}

export function correlationRequestId(request: IncomingMessage | Http2ServerRequest): string {
  return normalizedCorrelationId(request.headers);
}

function operationFor(method: string, url: string): TelemetryOperation {
  if (method !== 'POST') return 'http_other';
  switch (url.split('?')[0]) {
    case '/v1/tenants/register':
      return 'registration';
    case '/v1/auth/otp-requests':
      return 'otp_request';
    case '/v1/auth/otp-verifications':
      return 'otp_verification';
    default:
      return 'http_other';
  }
}

export function configureCorrelation(app: NestFastifyApplication, telemetry?: Telemetry): void {
  const active = new WeakMap<object, { span: SpanOperation; startedAt: number }>();
  const instance = app.getHttpAdapter().getInstance();
  if (telemetry) {
    instance.addHook('onRequest', (request, _reply, done) => {
      const span = telemetry.start(operationFor(request.method, request.url), {
        correlationId: request.id,
      });
      active.set(request, { span, startedAt: performance.now() });
      done();
    });
    instance.addHook('onResponse', (request, reply, done) => {
      const context = active.get(request);
      if (context) {
        const status = reply.statusCode;
        const outcome: TelemetryOutcome =
          status === 429
            ? 'throttled'
            : status >= 500
              ? 'failed'
              : status >= 400
                ? 'rejected'
                : 'accepted';
        context.span.finish(outcome, status);
      }
      done();
    });
  }
  instance.addHook('onSend', (request, reply, payload, done) => {
    void reply.header('x-correlation-id', request.id);
    done(null, payload);
  });
}
