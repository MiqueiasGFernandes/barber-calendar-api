import { describe, expect, it } from 'vitest';
import { redact } from '../../src/shared/observability/logger.js';
describe('security redaction', () => {
  it('redacts secrets and personal data recursively', () =>
    expect(
      redact({
        authorization: 'Bearer token',
        nested: { code: '123456', email: 'person@example.test', safe: 'ok' },
        access_token: 'jwt',
      }),
    ).toEqual({
      authorization: '[REDACTED]',
      nested: { code: '[REDACTED]', email: '[REDACTED]', safe: 'ok' },
      access_token: '[REDACTED]',
    }));
});
