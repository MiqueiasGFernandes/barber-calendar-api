import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, clock, resetDatabase, throttle, tx } from './support.js';
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
  afterAll(closeDatabase);
});
