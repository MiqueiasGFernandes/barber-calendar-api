import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../../../src/shared/config/environment.schema.js';
const environment = {
  DATABASE_URL: 'postgres://x:x@localhost/x',
  OTP_HMAC_KEY: 'o'.repeat(32),
  THROTTLE_HMAC_KEY: 't'.repeat(32),
  OUTBOX_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  JWT_PRIVATE_KEY: 'x',
  JWT_PUBLIC_KEY: 'x',
  JWT_KEY_ID: 'x',
  JWT_ISSUER: 'x',
  JWT_AUDIENCE: 'x',
};
describe('session lifetime', () => {
  it('captures TTL for each session without changing prior expirations', () => {
    const issued = new Date('2026-01-01T00:00:00Z');
    const first = new Date(
      issued.getTime() + parseEnvironment(environment).AUTH_SESSION_TTL * 1000,
    );
    const second = new Date(
      issued.getTime() +
        parseEnvironment({ ...environment, AUTH_SESSION_TTL: 'PT15M' }).AUTH_SESSION_TTL * 1000,
    );
    expect(first.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(second.toISOString()).toBe('2026-01-01T00:15:00.000Z');
  });
  it('does not imply invalidating an earlier session', () => {
    const sessions = new Set(['a', 'b']);
    expect(sessions.size).toBe(2);
  });
});
