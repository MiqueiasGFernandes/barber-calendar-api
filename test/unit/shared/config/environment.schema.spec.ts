import { describe, expect, it } from 'vitest';
import {
  durationSeconds,
  parseEnvironment,
} from '../../../../src/shared/config/environment.schema.js';
const base = {
  DATABASE_URL: 'postgres://x:x@localhost/x',
  OTP_HMAC_KEY: 'o'.repeat(32),
  THROTTLE_HMAC_KEY: 't'.repeat(32),
  OUTBOX_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  JWT_PRIVATE_KEY: 'private',
  JWT_PUBLIC_KEY: 'public',
  JWT_KEY_ID: 'kid',
  JWT_ISSUER: 'issuer',
  JWT_AUDIENCE: 'audience',
};
describe('environment', () => {
  it('uses 24 hours by default', () => expect(parseEnvironment(base).AUTH_SESSION_TTL).toBe(86400));
  it.each([
    ['PT15M', 900],
    ['P7D', 604800],
  ])('accepts inclusive limit %s', (value, seconds) =>
    expect(parseEnvironment({ ...base, AUTH_SESSION_TTL: value }).AUTH_SESSION_TTL).toBe(seconds),
  );
  it.each(['PT14M59S', 'P7DT1S', 'garbage'])('rejects %s', (value) =>
    expect(() => parseEnvironment({ ...base, AUTH_SESSION_TTL: value })).toThrow(),
  );
  it('parses composite durations', () => expect(durationSeconds('P1DT2H3M4S')).toBe(93784));
});
