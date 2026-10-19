import 'reflect-metadata';
import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { SCHEDULING_CLOCK } from '../../src/modules/scheduling/scheduling.module.js';
import { configureCorrelation, correlationRequestId } from '../../src/shared/http/correlation.js';
import { ProblemDetailsFilter } from '../../src/shared/http/problem-details.filter.js';
import { Telemetry } from '../../src/shared/observability/telemetry.js';
import { JsonLogger } from '../../src/shared/observability/logger.js';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { pool, resetDatabase } from './support.js';
import {
  SchedulingTestClock,
  seedSchedulingFixture,
  schedulingFixtureIds,
} from './scheduling-support.js';

const enabled = Boolean(process.env.DATABASE_URL);
describe.runIf(enabled)('reservas públicas de agendamento', () => {
  let app: NestFastifyApplication;
  let testClock: SchedulingTestClock;
  let telemetry: Telemetry;
  const lines: string[] = [];
  const spans = new InMemorySpanExporter();
  const testDate = '2030-01-07';
  const startsAt = `${testDate}T10:00:00-03:00`;
  const baseRequest = {
    service_id: schedulingFixtureIds.service,
    professional_id: null,
    starts_at: startsAt,
    guest_name: 'Cliente Privado',
    guest_phone: '+5511987654321',
    guest_email: 'private-customer@example.test',
  };
  const path = '/v1/public/tenants/fixture-a';

  beforeAll(async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    Object.assign(process.env, {
      NODE_ENV: 'test',
      OTP_HMAC_KEY: 'otp-public-e2e-secret'.padEnd(32, 'x'),
      THROTTLE_HMAC_KEY: 'throttle-public-e2e-secret'.padEnd(32, 'y'),
      OUTBOX_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      IDEMPOTENCY_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'),
      JWT_PRIVATE_KEY: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      JWT_PUBLIC_KEY: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      JWT_KEY_ID: 'public-e2e-key',
      JWT_ISSUER: 'barber-calendar-e2e',
      JWT_AUDIENCE: 'barber-calendar-e2e',
      EMAIL_PROVIDER: 'mailpit',
    });
    testClock = new SchedulingTestClock(new Date('2030-01-07T11:00:00Z'));
    telemetry = new Telemetry({
      logger: new JsonLogger((line) => lines.push(line)),
      spanProcessors: [new SimpleSpanProcessor(spans)],
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SCHEDULING_CLOCK)
      .useValue(testClock)
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

  beforeEach(async () => {
    await resetDatabase();
    await seedSchedulingFixture(pool);
    lines.length = 0;
    spans.reset();
  });

  it('lista apenas serviços ativos publicados e profissionais elegíveis', async () => {
    const response = await app.inject({ method: 'GET', url: `${path}/services` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      services: [
        {
          id: schedulingFixtureIds.service,
          name: 'Corte de exemplo',
          duration_minutes: 30,
          price_minor: 5000,
          currency_code: 'BRL',
          professionals: [
            { id: schedulingFixtureIds.professional, display_name: 'Profissional Exemplo' },
          ],
        },
      ],
    });
    expect(response.body).not.toContain('client@example.test');
  });

  it('lista horários com offset local, exclui bloqueios e retorna slots vazios fora da janela', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${path}/availability?service_id=${schedulingFixtureIds.service}&date=${testDate}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      slots: { starts_at: string; ends_at: string; professional_id: string }[];
      time_zone: string;
    }>();
    expect(body.time_zone).toBe('America/Sao_Paulo');
    expect(body.slots.some((slot) => slot.starts_at === `${testDate}T09:00:00-03:00`)).toBe(false);
    expect(
      body.slots.every(
        (slot) =>
          slot.professional_id === schedulingFixtureIds.professional &&
          slot.ends_at.endsWith('-03:00'),
      ),
    ).toBe(true);
    const outside = await app.inject({
      method: 'GET',
      url: `${path}/availability?service_id=${schedulingFixtureIds.service}&date=2030-02-07`,
    });
    expect(outside.statusCode).toBe(200);
    expect(outside.json<{ slots: unknown[] }>().slots).toEqual([]);
  });

  it('cria reserva de convidado, retorna somente sua confirmação, remove o slot e reproduz a resposta', async () => {
    const key = `guest-${randomUUID()}`;
    const response = await app.inject({
      method: 'POST',
      url: `${path}/appointments`,
      headers: { 'idempotency-key': key },
      payload: baseRequest,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: 'confirmed',
      service_name: 'Corte de exemplo',
      professional_name: 'Profissional Exemplo',
      starts_at: startsAt,
      ends_at: `${testDate}T10:30:00-03:00`,
    });
    expect(response.body).not.toContain('private-customer@example.test');
    expect(response.body).not.toContain('+5511987654321');
    const available = await app.inject({
      method: 'GET',
      url: `${path}/availability?service_id=${schedulingFixtureIds.service}&date=${testDate}`,
    });
    expect(
      available
        .json<{ slots: { starts_at: string }[] }>()
        .slots.some((slot) => slot.starts_at === startsAt),
    ).toBe(false);
    const replay = await app.inject({
      method: 'POST',
      url: `${path}/appointments`,
      headers: { 'idempotency-key': key },
      payload: baseRequest,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(response.json());
    await telemetry.forceFlush();
    const captured = JSON.stringify({
      lines,
      spans: spans
        .getFinishedSpans()
        .map((span) => ({ name: span.name, attributes: span.attributes })),
      metrics: [...telemetry.metrics.snapshot()],
    });
    for (const value of [
      baseRequest.guest_name,
      baseRequest.guest_phone,
      baseRequest.guest_email,
      key,
      response.json<{ id: string }>().id,
    ])
      expect(captured).not.toContain(value);
    expect(
      telemetry.metrics.snapshot().get('scheduling_replay:booking:replayed'),
    ).toBeGreaterThanOrEqual(1);
    expect(
      telemetry.metrics
        .histogramSnapshot()
        .get('scheduling_request_duration_seconds:scheduling_booking:accepted')?.count,
    ).toBeGreaterThanOrEqual(2);
    const event = await pool.query<{ correlation_id: string }>(
      "SELECT correlation_id FROM scheduling.appointment_events WHERE tenant_id=$1 AND event_type='created'",
      [schedulingFixtureIds.tenantA],
    );
    expect(event.rows[0]?.correlation_id).toBe(response.headers['x-correlation-id']);
  });

  it('rejeita reutilização da chave com outro corpo e concorrência para o mesmo horário sem expor PII', async () => {
    const key = `conflict-${randomUUID()}`;
    const first = await app.inject({
      method: 'POST',
      url: `${path}/appointments`,
      headers: { 'idempotency-key': key },
      payload: baseRequest,
    });
    expect(first.statusCode).toBe(201);
    const mismatch = await app.inject({
      method: 'POST',
      url: `${path}/appointments`,
      headers: { 'idempotency-key': key },
      payload: { ...baseRequest, starts_at: `${testDate}T10:30:00-03:00` },
    });
    expect(mismatch.statusCode).toBe(409);
    const competing = await app.inject({
      method: 'POST',
      url: `${path}/appointments`,
      headers: { 'idempotency-key': `second-${randomUUID()}` },
      payload: baseRequest,
    });
    expect(competing.statusCode).toBe(409);
    expect(competing.body).not.toContain('private-customer@example.test');
    expect(competing.body).not.toContain(schedulingFixtureIds.appointment);
  });

  it('rejeita entrada malformada, chave ausente e tenant inexistente', async () => {
    const malformed = await app.inject({
      method: 'POST',
      url: `${path}/appointments`,
      headers: { 'idempotency-key': `malformed-${randomUUID()}` },
      payload: { ...baseRequest, guest_phone: '11999999999' },
    });
    expect(malformed.statusCode).toBe(422);
    const noKey = await app.inject({
      method: 'POST',
      url: `${path}/appointments`,
      payload: baseRequest,
    });
    expect(noKey.statusCode).toBe(422);
    const missing = await app.inject({
      method: 'GET',
      url: '/v1/public/tenants/no-such-shop/services',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('aplica limite por minuto antes do controller, informa Retry-After e não confia em proxy não configurado', async () => {
    for (let index = 0; index < 10; index++) {
      const response = await app.inject({
        method: 'POST',
        url: `${path}/appointments`,
        headers: {
          'idempotency-key': `invalid-request-${index}-key`,
          'x-forwarded-for': `198.51.100.${index + 1}`,
        },
        payload: {},
      });
      expect(response.statusCode).toBe(422);
    }
    const limited = await app.inject({
      method: 'POST',
      url: `${path}/appointments`,
      headers: { 'idempotency-key': 'eleventh-request-key', 'x-forwarded-for': '203.0.113.10' },
      payload: {},
    });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['content-type']).toContain('application/problem+json');
    expect(
      telemetry.metrics.snapshot().get('scheduling_throttled:scheduling_booking:throttled'),
    ).toBeGreaterThanOrEqual(1);
    expect(lines.join('')).not.toContain('203.0.113.10');
    const digest = createHmac('sha256', 'throttle-public-e2e-secret'.padEnd(32, 'y'))
      .update('127.0.0.1')
      .digest();
    const stored = await pool.query<{ ip_hash: Buffer }>(
      "SELECT ip_hash FROM scheduling.public_throttle_windows WHERE tenant_id=$1 AND operation_group='booking' LIMIT 1",
      [schedulingFixtureIds.tenantA],
    );
    expect(stored.rows[0]?.ip_hash.equals(digest)).toBe(true);
    expect(stored.rows[0]?.ip_hash.includes(Buffer.from('203.0.113.10'))).toBe(false);
  });

  afterAll(async () => {
    await app?.close();
    await telemetry?.onModuleDestroy();
  });
});
