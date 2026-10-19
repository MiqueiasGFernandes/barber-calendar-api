import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import {
  EMAIL_SENDER,
  OUTBOX_DISPATCHER,
  OTP_CRYPTO,
} from '../../src/modules/authentication/authentication.module.js';
import { CryptoOtpAdapter } from '../../src/shared/infrastructure/crypto/otp-crypto.adapter.js';
import { MailpitEmailSender } from '../../src/modules/notifications/infrastructure/email/mailpit-email-sender.js';
import { Telemetry } from '../../src/shared/observability/telemetry.js';
import { JsonLogger } from '../../src/shared/observability/logger.js';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { MetricReader } from '@opentelemetry/sdk-metrics';
import type { OutboxDispatcher } from '../../src/modules/outbox/infrastructure/outbox-dispatcher.js';
import { ProblemDetailsFilter } from '../../src/shared/http/problem-details.filter.js';
import { configureCorrelation, correlationRequestId } from '../../src/shared/http/correlation.js';
import { pool, resetDatabase } from './support.js';

const enabled = Boolean(process.env.DATABASE_URL);

describe.runIf(enabled)('pilha HTTP e entrega reais', () => {
  let app: NestFastifyApplication;
  let telemetry: Telemetry;
  let exportedSpans: InMemorySpanExporter;
  let logs: string[];
  let metricReader: E2eMetricReader;

  class E2eMetricReader extends MetricReader {
    protected async onForceFlush(): Promise<void> {}
    protected async onShutdown(): Promise<void> {}
  }
  class DeterministicOtpAdapter extends CryptoOtpAdapter {
    override generate(): string {
      return '654321';
    }
  }

  beforeAll(async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    Object.assign(process.env, {
      NODE_ENV: 'test',
      OTP_HMAC_KEY: 'otp-e2e-secret'.padEnd(32, 'x'),
      THROTTLE_HMAC_KEY: 'throttle-e2e-secret'.padEnd(32, 'y'),
      OUTBOX_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      JWT_PRIVATE_KEY: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      JWT_PUBLIC_KEY: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      JWT_KEY_ID: 'e2e-key',
      JWT_ISSUER: 'barber-calendar-e2e',
      JWT_AUDIENCE: 'barber-calendar-e2e',
      EMAIL_PROVIDER: 'mailpit',
    });
    exportedSpans = new InMemorySpanExporter();
    logs = [];
    metricReader = new E2eMetricReader();
    telemetry = new Telemetry({
      logger: new JsonLogger((line) => logs.push(line)),
      spanProcessors: [new SimpleSpanProcessor(exportedSpans)],
      metricReaders: [metricReader],
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(new MailpitEmailSender('127.0.0.1', Number(process.env.E2E_SMTP_PORT ?? 51025)))
      .overrideProvider(OTP_CRYPTO)
      .useValue(new DeterministicOtpAdapter('otp-e2e-secret'.padEnd(32, 'x')))
      .overrideProvider(Telemetry)
      .useValue(telemetry)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ requestIdHeader: false, genReqId: correlationRequestId }),
    );
    configureCorrelation(app, telemetry);
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(resetDatabase);

  it('atravessa controller, PostgreSQL, worker e Mailpit', async () => {
    const email = `stack-${randomUUID()}@example.test`;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tenants/register',
      headers: { 'x-correlation-id': randomUUID() },
      payload: {
        tenant_name: 'Barbearia Stack',
        tenant_slug: `stack-${randomUUID().slice(0, 8)}`,
        administrator_email: email,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe(
      `/v1/tenants/registration-attempts/${response.json().registration_attempt_id}`,
    );
    const body = response.json<{ challenge_id: string }>();
    expect(body.challenge_id).toMatch(/^[0-9a-f-]{36}$/i);
    const correlationId = String(response.headers['x-correlation-id']);

    const cipher = (
      await pool.query<{ envelope: string }>(
        `SELECT encode(envelope_ciphertext,'base64') AS envelope FROM identity.email_outbox WHERE challenge_id=$1`,
        [body.challenge_id],
      )
    ).rows[0]?.envelope;
    expect(cipher).toBeTruthy();
    const dispatcher = app.get<OutboxDispatcher>(OUTBOX_DISPATCHER);
    expect(await dispatcher.dispatch()).toBe(1);
    const outbox = await pool.query<{ status: string; purged: boolean }>(
      `SELECT status,envelope_ciphertext IS NULL AS purged FROM identity.email_outbox WHERE challenge_id=$1`,
      [body.challenge_id],
    );
    expect(outbox.rows[0]).toEqual({ status: 'delivered', purged: true });

    const mailpit = await fetch(
      `http://127.0.0.1:${process.env.E2E_MAILPIT_PORT ?? '58025'}/api/v1/messages`,
    );
    expect(mailpit.ok).toBe(true);
    const messages = (await mailpit.json()) as { messages?: { To?: { Address?: string }[] }[] };
    expect(JSON.stringify(messages.messages ?? [])).toContain(email);

    const code = '654321';
    const verified = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp-verifications',
      headers: { 'x-correlation-id': correlationId },
      payload: { challenge_id: body.challenge_id, code },
    });
    expect(verified.statusCode).toBe(201);
    const jwt = verified.json<{ access_token: string }>().access_token;
    await telemetry.forceFlush();
    const relatedSpans = exportedSpans
      .getFinishedSpans()
      .filter((span) => span.attributes.correlation_id === response.headers['x-correlation-id']);
    const serializedSpanAttributes = JSON.stringify(
      relatedSpans.map((span) => ({ name: span.name, ...span.attributes })),
    );
    expect(relatedSpans.map((span) => span.name)).toContain('registration');
    expect(relatedSpans.map((span) => span.name)).toContain('outbox_delivery');
    expect(relatedSpans.map((span) => span.name)).toContain('otp_verification');
    expect(logs.join('')).toContain(correlationId);
    const correlatedLog = logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.correlation_id === correlationId);
    expect(correlatedLog?.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(correlatedLog?.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(logs.join('')).not.toContain(email);
    expect(logs.join('')).not.toContain(code);
    expect(logs.join('')).not.toContain(jwt);
    expect(logs.join('')).not.toContain('127.0.0.1');
    const envelopeValue = cipher ?? '';
    expect(logs.join('')).not.toContain(envelopeValue);
    expect(serializedSpanAttributes).not.toContain(code);
    expect(serializedSpanAttributes).not.toContain(jwt);
    expect(serializedSpanAttributes).not.toContain(email);
    expect(serializedSpanAttributes).not.toContain(envelopeValue);
    const measurements = await metricReader.collect();
    const metricNames = measurements.resourceMetrics.scopeMetrics.flatMap((scope) =>
      scope.metrics.map((metric) => metric.descriptor.name),
    );
    expect(metricNames).toContain('otp_decision');
    expect(metricNames).toContain('outbox_age_seconds');
    expect(metricNames).toContain('outbox_delivery_latency_seconds');
  });

  it.each([undefined, 'not-a-uuid'])(
    'normaliza correlação ausente ou inválida (%s)',
    async (value) => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tenants/register',
        headers: value === undefined ? {} : { 'x-correlation-id': value },
        payload: {
          tenant_name: 'Barbearia Correlation',
          tenant_slug: `correlation-${randomUUID().slice(0, 8)}`,
          administrator_email: `correlation-${randomUUID()}@example.test`,
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/i);
    },
  );

  it('ignora X-Forwarded-For quando nenhum proxy confiável está configurado', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/tenants/register',
      headers: { 'x-forwarded-for': '198.51.100.77' },
      payload: {
        tenant_name: 'Proxy seguro',
        tenant_slug: `proxy-${randomUUID().slice(0, 8)}`,
        administrator_email: `proxy-${randomUUID()}@example.test`,
      },
    });
    const digest = createHmac('sha256', 'throttle-e2e-secret'.padEnd(32, 'y'))
      .update('127.0.0.1')
      .digest();
    const result = await pool.query(
      `SELECT 1 FROM identity.throttle_subjects WHERE scope_type='ip' AND scope_digest=$1`,
      [digest],
    );
    expect(result.rowCount).toBe(1);
  });

  it('expõe 429, Retry-After e Problem Details ao atingir limite HTTP', async () => {
    const email = `limit-${randomUUID()}@example.test`;
    for (let index = 0; index < 5; index++) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tenants/register',
        payload: {
          tenant_name: 'Limite HTTP',
          tenant_slug: `limit-${index}-${randomUUID().slice(0, 8)}`,
          administrator_email: email,
        },
      });
      expect(response.statusCode).toBe(201);
    }
    const limited = await app.inject({
      method: 'POST',
      url: '/v1/tenants/register',
      payload: {
        tenant_name: 'Limite HTTP',
        tenant_slug: `limit-six-${randomUUID().slice(0, 8)}`,
        administrator_email: email,
      },
    });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['content-type']).toContain('application/problem+json');
    expect(limited.json()).toMatchObject({
      status: 429,
      code: 'too_many_requests',
      correlation_id: limited.headers['x-correlation-id'],
    });
    const audit = await pool.query(
      `SELECT 1 FROM audit.security_events WHERE event_type='otp_rate_limited' AND correlation_id=$1`,
      [limited.headers['x-correlation-id']],
    );
    expect(audit.rowCount).toBe(1);
    const measurements = await metricReader.collect();
    const throttledMetric = measurements.resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((metric) => metric.descriptor.name === 'otp_throttled');
    expect(
      throttledMetric?.dataPoints.some(
        (point) =>
          point.attributes.operation === 'registration' && point.attributes.outcome === 'throttled',
      ),
    ).toBe(true);
  });

  afterAll(async () => {
    await app?.close();
    await telemetry?.onModuleDestroy();
  });
});
