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
import { adminPool, pool, resetDatabase } from './support.js';
import { configureCorrelation, correlationRequestId } from '../../src/shared/http/correlation.js';
import { Telemetry } from '../../src/shared/observability/telemetry.js';
import { JsonLogger } from '../../src/shared/observability/logger.js';
import { SCHEDULING_CLOCK } from '../../src/modules/scheduling/scheduling.module.js';
import { SchedulingTestClock, seedSchedulingFixture } from './scheduling-support.js';

const enabled = Boolean(process.env.DATABASE_URL);
describe.runIf(enabled)('auditoria administrativa HTTP', () => {
  let app: NestFastifyApplication;
  let telemetry: Telemetry;
  const token = (role: 'administrator' | 'member') => `test-${role}`;
  const headers = (key?: string, role: 'administrator' | 'member' = 'administrator') => ({
    authorization: `Bearer ${token(role)}`,
    ...(key ? { 'idempotency-key': key } : {}),
  });
  const key = () => `management-${randomUUID()}`;
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
    const testClock = new SchedulingTestClock(new Date('2030-01-07T11:00:00Z'));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue({
        verify: async (value: string) => ({
          sub: 'test-user',
          sid: value,
          tenantId: schedulingFixtureIds.tenantA,
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
          tenantId: schedulingFixtureIds.tenantA,
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
  });
  it('audita as nove mutações, repetições e rejeições sem novo endpoint', async () => {
    const h = () => headers(key());
    const professional = await app.inject({
      method: 'POST',
      url: '/v1/management/professionals',
      headers: h(),
      payload: { display_name: 'Auditado' },
    });
    expect(professional.statusCode).toBe(201);
    const pid = professional.json<{ id: string }>().id;
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/management/professionals/${pid}`,
          headers: h(),
          payload: { display_name: 'Novo Nome' },
        })
      ).statusCode,
    ).toBe(200);
    const service = await app.inject({
      method: 'POST',
      url: '/v1/management/services',
      headers: h(),
      payload: {
        name: 'Barba',
        duration_minutes: 20,
        price_minor: 2500,
        currency_code: 'BRL',
        professional_ids: [pid],
      },
    });
    expect(service.statusCode).toBe(201);
    const sid = service.json<{ id: string }>().id;
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/management/services/${sid}`,
          headers: h(),
          payload: { description: 'private@example.test secret=abc', status: 'inactive' },
        })
      ).statusCode,
    ).toBe(200);
    const periods = {
      periods: [{ iso_weekday: 1, starts_local_time: '09:00:00', ends_local_time: '12:00:00' }],
    };
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/v1/management/professionals/${pid}/weekly-periods`,
          headers: h(),
          payload: periods,
        })
      ).statusCode,
    ).toBe(200);
    const exception = await app.inject({
      method: 'POST',
      url: `/v1/management/professionals/${pid}/exceptions`,
      headers: h(),
      payload: {
        kind: 'blocked',
        starts_at: '2030-01-08T12:00:00Z',
        ends_at: '2030-01-08T13:00:00Z',
      },
    });
    expect(exception.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/management/professionals/${pid}/exceptions/${exception.json<{ id: string }>().id}`,
          headers: h(),
        })
      ).statusCode,
    ).toBe(204);
    const settings = { slot_interval_minutes: 20, minimum_advance_minutes: 0 };
    const same = headers(key());
    for (let i = 0; i < 2; i++)
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: '/v1/management/scheduling-settings',
            headers: same,
            payload: settings,
          })
        ).statusCode,
      ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/v1/management/time-zone',
          headers: h(),
          payload: { time_zone: 'America/Fortaleza' },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/v1/management/professionals/${pid}/weekly-periods`,
          headers: h(),
          payload: periods,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/management/configuration-audit', headers: h() }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/management/professionals',
          headers: headers(key(), 'member'),
          payload: { display_name: 'Negado' },
        })
      ).statusCode,
    ).toBe(403);
    const rows = (await adminPool.query('SELECT * FROM scheduling.configuration_events')).rows;
    expect(rows).toHaveLength(9);
    expect(new Set(rows.map((x) => x.operation)).size).toBe(9);
    expect(
      rows.every(
        (x) =>
          x.tenant_id === schedulingFixtureIds.tenantA &&
          x.actor_membership_id === schedulingFixtureIds.administrator,
      ),
    ).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('private@example.test');
    expect(JSON.stringify(rows)).not.toContain('secret=abc');
  });
  afterAll(async () => {
    await app?.close();
    await telemetry?.onModuleDestroy();
  });
});
