import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { ThrottleRetentionJob } from '../../src/modules/authentication/infrastructure/persistence/throttle-retention.job.js';
import { closeDatabase, clock, pool, resetDatabase, throttle, tx } from './support.js';
const enabled = Boolean(process.env.DATABASE_URL);
describe.runIf(enabled)('OTP throttling', () => {
  beforeEach(resetDatabase);
  it('limits the sixth email issuance in a moving 15 minute window with Retry-After', async () => {
    for (let index = 0; index < 5; index++)
      await tx.run((client) =>
        throttle.enforce(client, {
          tenantSlug: 'tenant',
          email: 'same@example.test',
          ip: `203.0.113.${index + 10}`,
          action: 'otp_issue',
          now: new Date(clock.now().getTime() + index),
        }),
      );
    await expect(
      tx.run((client) =>
        throttle.enforce(client, {
          tenantSlug: 'tenant',
          email: 'same@example.test',
          ip: '203.0.113.99',
          action: 'otp_issue',
          now: new Date(clock.now().getTime() + 1000),
        }),
      ),
    ).rejects.toMatchObject({ status: 429, code: 'too_many_requests', retryAfterSeconds: 899 });
  });
  it('shares the normalized email issuance limit across tenants and registration/login', async () => {
    for (let index = 0; index < 5; index++)
      await tx.run((client) =>
        throttle.enforce(client, {
          tenantSlug: `tenant-${index}`,
          email: 'shared@example.test',
          ip: `203.0.114.${index + 10}`,
          action: index < 2 ? 'registration' : 'otp_issue',
          now: new Date(clock.now().getTime() + index),
        }),
      );
    await expect(
      tx.run((client) =>
        throttle.enforce(client, {
          tenantSlug: 'another-tenant',
          email: 'shared@example.test',
          ip: '203.0.114.99',
          action: 'otp_issue',
          now: new Date(clock.now().getTime() + 1000),
        }),
      ),
    ).rejects.toMatchObject({ status: 429 });
  });
  it('accumulates verification failures across challenges', async () => {
    for (let index = 0; index < 10; index++)
      await tx.run((client) =>
        throttle.enforce(client, {
          tenantSlug: 'tenant',
          email: 'same@example.test',
          ip: `198.51.100.${index}`,
          action: 'otp_verify_failure',
          now: new Date(clock.now().getTime() + index),
        }),
      );
    await expect(
      tx.run((client) =>
        throttle.enforce(client, {
          tenantSlug: 'tenant',
          email: 'same@example.test',
          ip: '198.51.100.99',
          action: 'otp_verify_failure',
          now: new Date(clock.now().getTime() + 1000),
        }),
      ),
    ).rejects.toMatchObject({ status: 429 });
  });
  it('limits the twenty-first issuance from the same IP', async () => {
    for (let index = 0; index < 20; index++)
      await tx.run((client) =>
        throttle.enforce(client, {
          tenantSlug: 'tenant',
          email: `person-${index}@example.test`,
          ip: '192.0.2.44',
          action: 'otp_issue',
          now: new Date(clock.now().getTime() + index),
        }),
      );
    await expect(
      tx.run((client) =>
        throttle.enforce(client, {
          tenantSlug: 'tenant',
          email: 'person-21@example.test',
          ip: '192.0.2.44',
          action: 'otp_issue',
          now: new Date(clock.now().getTime() + 1000),
        }),
      ),
    ).rejects.toMatchObject({ status: 429 });
  });
  it('reopens capacity only as events leave the moving window', async () => {
    for (let index = 0; index < 5; index++)
      await tx.run((client) =>
        throttle.enforce(client, {
          tenantSlug: 'tenant',
          email: 'window@example.test',
          ip: `192.0.2.${index}`,
          action: 'otp_issue',
          now: new Date(clock.now().getTime() + index),
        }),
      );
    await expect(
      tx.run((client) =>
        throttle.enforce(client, {
          tenantSlug: 'tenant',
          email: 'window@example.test',
          ip: '192.0.2.99',
          action: 'otp_issue',
          now: new Date(clock.now().getTime() + 899_000),
        }),
      ),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      tx.run((client) =>
        throttle.enforce(client, {
          tenantSlug: 'tenant',
          email: 'window@example.test',
          ip: '192.0.2.99',
          action: 'otp_issue',
          now: new Date(clock.now().getTime() + 900_001),
        }),
      ),
    ).resolves.toBeUndefined();
  });
  it('serializes concurrent decisions without a burst past the limit', async () => {
    const decisions = await Promise.allSettled(
      Array.from({ length: 100 }, (_, index) =>
        tx.run((client) =>
          throttle.enforce(client, {
            tenantSlug: 'tenant',
            email: 'parallel@example.test',
            ip: `198.18.0.${index}`,
            action: 'otp_issue',
            now: clock.now(),
          }),
        ),
      ),
    );
    expect(decisions.filter((decision) => decision.status === 'fulfilled')).toHaveLength(5);
    expect(decisions.filter((decision) => decision.status === 'rejected')).toHaveLength(95);
  });
  it('limits the fifty-first verification failure from one IP', async () => {
    for (let index = 0; index < 50; index++)
      await tx.run((client) =>
        throttle.enforce(client, {
          tenantSlug: 'tenant',
          email: `failure-${index}@example.test`,
          ip: '198.18.1.10',
          action: 'otp_verify_failure',
          now: new Date(clock.now().getTime() + index),
        }),
      );
    await expect(
      tx.run((client) =>
        throttle.enforce(client, {
          tenantSlug: 'tenant',
          email: 'failure-51@example.test',
          ip: '198.18.1.10',
          action: 'otp_verify_failure',
          now: new Date(clock.now().getTime() + 1000),
        }),
      ),
    ).rejects.toMatchObject({ status: 429 });
  });
  it('mantém p95 abaixo de dois segundos sob 100 decisões concorrentes', async () => {
    const timings: number[] = [];
    const decisions = await Promise.allSettled(
      Array.from({ length: 100 }, (_, index) => {
        const started = performance.now();
        return tx
          .run((client) =>
            throttle.enforce(client, {
              tenantSlug: 'performance-tenant',
              email: `performance-${index}@example.test`,
              ip: '198.18.2.10',
              action: 'otp_issue',
              now: clock.now(),
            }),
          )
          .finally(() => timings.push(performance.now() - started));
      }),
    );
    expect(decisions.filter((decision) => decision.status === 'fulfilled')).toHaveLength(20);
    timings.sort((left, right) => left - right);
    expect(timings[Math.ceil(timings.length * 0.95) - 1]).toBeLessThan(2000);
  });
  it('expurga somente eventos anteriores à janela de 90 minutos', async () => {
    const subjectId = randomUUID();
    const now = clock.now();
    await pool.query(
      `INSERT INTO identity.throttle_subjects(id,scope_type,scope_digest,created_at) VALUES($1,'ip',$2,$3)`,
      [subjectId, Buffer.alloc(32, 11), now],
    );
    await pool.query(
      `INSERT INTO identity.throttle_events(id,subject_id,action,occurred_at) VALUES($1,$3,'otp_issue',$4),($2,$3,'otp_issue',$5)`,
      [randomUUID(), randomUUID(), subjectId, new Date(now.getTime() - 90 * 60 * 1000 - 1), now],
    );
    const deleted = await new ThrottleRetentionJob(tx).purge(now);
    expect(deleted).toBe(1);
    const remaining = await pool.query(
      `SELECT count(*)::int count FROM identity.throttle_events WHERE subject_id=$1`,
      [subjectId],
    );
    expect(remaining.rows[0]?.count).toBe(1);
  });
  afterAll(closeDatabase);
});
