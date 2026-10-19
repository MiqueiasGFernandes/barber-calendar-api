import 'reflect-metadata';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import {
  TENANT_REPOSITORY,
  TOKEN_VERIFIER,
} from '../../src/modules/authentication/infrastructure/http/tenant-session.guard.js';
import { schedulingFixtureIds } from './scheduling-support.js';
import { pool, resetDatabase } from './support.js';
import { configureCorrelation, correlationRequestId } from '../../src/shared/http/correlation.js';
import { Telemetry } from '../../src/shared/observability/telemetry.js';
import { JsonLogger } from '../../src/shared/observability/logger.js';
import { SCHEDULING_CLOCK } from '../../src/modules/scheduling/scheduling.module.js';
import { SchedulingTestClock, seedSchedulingFixture } from './scheduling-support.js';

const enabled = Boolean(process.env.DATABASE_URL);
const publicId = '80000000-0000-4000-8000-000000000001';
describe.runIf(enabled)('ciclo administrativo dos agendamentos', () => {
  let app: NestFastifyApplication;
  let telemetry: Telemetry;
  const testClock = new SchedulingTestClock(new Date('2030-01-07T11:00:00Z'));
  const token = (role: 'administrator' | 'member') => `test-${role}`;
  const headers = (key?: string, role: 'administrator' | 'member' = 'administrator') => ({
    authorization: `Bearer ${token(role)}`,
    ...(key ? { 'idempotency-key': key } : {}),
  });
  const key = () => `lifecycle-${randomUUID()}`;
  const route = (command: string, id = publicId) => `/v1/management/appointments/${id}/${command}`;
  const range = 'starts_from=2030-01-07T00:00:00Z&ends_before=2030-01-08T00:00:00Z';
  const availability = async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/public/tenants/fixture-a/availability?service_id=${schedulingFixtureIds.service}&date=2030-01-07`,
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ slots: { starts_at: string }[] }>().slots.map((slot) => slot.starts_at);
  };
  beforeAll(async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    Object.assign(process.env, {
      NODE_ENV: 'test',
      OTP_HMAC_KEY: 'otp-management-e2e-secret'.padEnd(32, 'x'),
      THROTTLE_HMAC_KEY: 'throttle-management-e2e-secret'.padEnd(32, 'y'),
      OUTBOX_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      IDEMPOTENCY_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'),
      JWT_PRIVATE_KEY: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      JWT_PUBLIC_KEY: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      JWT_KEY_ID: 'management-e2e-key',
      JWT_ISSUER: 'barber-calendar-e2e',
      JWT_AUDIENCE: 'barber-calendar-e2e',
      EMAIL_PROVIDER: 'mailpit',
    });
    telemetry = new Telemetry({ logger: new JsonLogger(() => {}) });

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue({
        verify: async (value: string) => ({
          sub: 'test-user',
          sid: value,
          tenantId:
            value === 'test-other' ? schedulingFixtureIds.tenantB : schedulingFixtureIds.tenantA,
          membershipId: value.endsWith('member')
            ? schedulingFixtureIds.member
            : schedulingFixtureIds.administrator,
          role: value.endsWith('member') ? 'member' : 'administrator',
          issuedAt: new Date('2030-01-01Z'),
          expiresAt: new Date('2031-01-01Z'),
        }),
      })
      .overrideProvider(TENANT_REPOSITORY)
      .useValue({
        authorizeSession: async (sid: string) => ({
          userId: 'test-user',
          tenantId:
            sid === 'test-other' ? schedulingFixtureIds.tenantB : schedulingFixtureIds.tenantA,
          membershipId: sid.endsWith('member')
            ? schedulingFixtureIds.member
            : schedulingFixtureIds.administrator,
          role: sid.endsWith('member') ? 'member' : 'administrator',
          expiresAt: new Date('2031-01-01Z'),
        }),
      })
      .overrideProvider(Telemetry)
      .useValue(telemetry)
      .overrideProvider(SCHEDULING_CLOCK)
      .useValue(testClock)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ requestIdHeader: false, genReqId: correlationRequestId }),
    );
    configureCorrelation(app, telemetry);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    await resetDatabase();
    await seedSchedulingFixture(pool);
    testClock.set(new Date('2030-01-07T11:00:00Z'));
  });

  it('consulta por período, profissional e estado com campos exatos e histórico consultável', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/management/appointments?${range}&professional_id=${schedulingFixtureIds.professional}&status=confirmed`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    const appointments = response.json<{ appointments: Record<string, unknown>[] }>().appointments;
    expect(appointments).toHaveLength(1);
    expect(appointments[0]).toMatchObject({
      id: schedulingFixtureIds.appointment,
      status: 'confirmed',
      service_name: 'Corte de exemplo',
      professional_name: 'Profissional Exemplo',
      guest_name: 'Cliente Exemplo',
      guest_phone: '+5511999999999',
      guest_email: 'client@example.test',
      starts_at: '2030-01-07T09:00:00-03:00',
    });
    expect(Object.keys(appointments[0] ?? {}).sort()).toEqual(
      [
        'id',
        'status',
        'service_id',
        'service_name',
        'professional_id',
        'professional_name',
        'starts_at',
        'ends_at',
        'guest_name',
        'guest_phone',
        'guest_email',
      ].sort(),
    );
    const empty = await app.inject({
      method: 'GET',
      url: `/v1/management/appointments?${range}&professional_id=${schedulingFixtureIds.tenantB}`,
      headers: headers(),
    });
    expect(empty.json()).toEqual({ appointments: [] });
  });
  it('reagenda atomicamente, libera o intervalo anterior e cancela com disponibilidade em menos de cinco segundos', async () => {
    expect(await availability()).not.toContain('2030-01-07T09:00:00-03:00');
    const requestKey = key();
    const moved = await app.inject({
      method: 'POST',
      url: route('rescheduling'),
      headers: headers(requestKey),
      payload: { starts_at: '2030-01-07T10:00:00-03:00' },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toMatchObject({
      id: schedulingFixtureIds.appointment,
      status: 'confirmed',
      starts_at: '2030-01-07T10:00:00-03:00',
    });
    const slots = await availability();
    expect(slots).toContain('2030-01-07T09:00:00-03:00');
    expect(slots).not.toContain('2030-01-07T10:00:00-03:00');
    const cancelKey = key();
    const started = performance.now();
    const cancelled = await app.inject({
      method: 'POST',
      url: route('cancellation'),
      headers: headers(cancelKey),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ status: 'cancelled' });
    expect(await availability()).toContain('2030-01-07T10:00:00-03:00');
    expect(performance.now() - started).toBeLessThan(5000);
    const replay = await app.inject({
      method: 'POST',
      url: route('rescheduling'),
      headers: headers(requestKey),
      payload: { starts_at: '2030-01-07T10:00:00-03:00' },
    });
    expect(replay.json()).toEqual(moved.json());
    expect(
      (
        await app.inject({
          method: 'POST',
          url: route('cancellation'),
          headers: headers(cancelKey),
        })
      ).json(),
    ).toEqual(cancelled.json());
    expect(
      (
        await app.inject({
          method: 'POST',
          url: route('cancellation'),
          headers: headers(cancelKey, 'member'),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: route('cancellation'),
          headers: { authorization: 'Bearer test-other', 'idempotency-key': cancelKey },
        })
      ).statusCode,
    ).toBe(404);
    expect(cancelled.headers['cache-control']).toBe('no-store');
    const history = await app.inject({
      method: 'GET',
      url: `/v1/management/appointments?${range}&status=cancelled`,
      headers: headers(),
    });
    expect(history.json<{ appointments: unknown[] }>().appointments).toHaveLength(1);
  });
  it('retém o horário original em conflito e consulta bloqueios pela rota de exceções', async () => {
    const block = await app.inject({
      method: 'POST',
      url: `/v1/management/professionals/${schedulingFixtureIds.professional}/exceptions`,
      headers: headers(key()),
      payload: {
        kind: 'blocked',
        starts_at: '2030-01-07T13:00:00Z',
        ends_at: '2030-01-07T14:00:00Z',
      },
    });
    expect(block.statusCode).toBe(201);
    const blocked = await app.inject({
      method: 'GET',
      url: `/v1/management/professionals/${schedulingFixtureIds.professional}/exceptions?${range}`,
      headers: headers(),
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json<{ exceptions: unknown[] }>().exceptions).toHaveLength(1);
    const move = await app.inject({
      method: 'POST',
      url: route('rescheduling'),
      headers: headers(key()),
      payload: { starts_at: '2030-01-07T10:00:00-03:00' },
    });
    expect(move.statusCode).toBe(409);
    expect(move.body).not.toContain('client@example.test');
    expect(
      (
        await pool.query<{ starts_at: Date }>(
          'SELECT starts_at FROM scheduling.appointments WHERE id=$1',
          [schedulingFixtureIds.appointment],
        )
      ).rows[0]?.starts_at.toISOString(),
    ).toBe('2030-01-07T12:00:00.000Z');
  });
  it.each(['no_show', 'attended'] as const)(
    'respeita o limiar de %s e impede reabertura ou outras transições finais',
    async (status) => {
      const threshold = status === 'no_show' ? '2030-01-07T12:00:00Z' : '2030-01-07T12:30:00Z';
      const k = key();
      testClock.set(new Date(Date.parse(threshold) - 1));
      expect(
        (
          await app.inject({
            method: 'POST',
            url: route('outcome'),
            headers: headers(k),
            payload: { status },
          })
        ).statusCode,
      ).toBe(409);
      testClock.set(new Date(threshold));
      const result = await app.inject({
        method: 'POST',
        url: route('outcome'),
        headers: headers(k),
        payload: { status },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({ status });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: route('outcome'),
            headers: headers(k),
            payload: { status },
          })
        ).json(),
      ).toEqual(result.json());
      for (const [command, payload] of [
        ['cancellation', {}],
        ['rescheduling', { starts_at: '2030-01-07T11:00:00-03:00' }],
        ['outcome', { status: status === 'attended' ? 'no_show' : 'attended' }],
      ] as const) {
        const response = await app.inject({
          method: 'POST',
          url: route(command),
          headers: headers(key()),
          payload,
        });
        expect(response.statusCode).toBe(409);
      }
      expect(
        (
          await pool.query('SELECT id FROM scheduling.appointment_events WHERE appointment_id=$1', [
            schedulingFixtureIds.appointment,
          ])
        ).rowCount,
      ).toBe(1);
    },
  );
  it('exige sessão e administrador antes de replay, valida entradas e retorna 404 fora do escopo', async () => {
    for (const command of ['cancellation', 'rescheduling', 'outcome']) {
      expect((await app.inject({ method: 'POST', url: route(command) })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: route(command),
            headers: headers(key(), 'member'),
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (await app.inject({ method: 'GET', url: `/v1/management/appointments?${range}` })).statusCode,
    ).toBe(401);
    const other = await app.inject({
      method: 'GET',
      url: `/v1/management/appointments?${range}`,
      headers: { authorization: 'Bearer test-other' },
    });
    expect(other.statusCode).toBe(200);
    expect(other.json()).toEqual({ appointments: [] });
    for (const query of [
      'starts_from=invalid&ends_before=2030-01-07T00:00:00Z',
      `${range}&tenant_id=other`,
      'starts_from=2030-01-08T00:00:00Z&ends_before=2030-01-07T00:00:00Z',
    ])
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/management/appointments?${query}`,
            headers: headers(),
          })
        ).statusCode,
      ).toBe(422);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: route('outcome'),
          headers: headers(key()),
          payload: { status: 'confirmed' },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: route('rescheduling'),
          headers: headers(key()),
          payload: {
            starts_at: '2030-01-07T10:00:00-03:00',
            tenant_id: schedulingFixtureIds.tenantB,
          },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await app.inject({ method: 'POST', url: route('cancellation'), headers: headers() }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: route('cancellation', randomUUID()),
          headers: headers(key()),
        })
      ).statusCode,
    ).toBe(404);
  });
  afterAll(async () => {
    await app?.close();
    await telemetry?.onModuleDestroy();
  });
});
