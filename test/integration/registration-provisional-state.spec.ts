import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
describe('registration provisional state', () => {
  it('inserts only attempt, challenge, outbox and event in the start path', () => {
    const source =
      readFileSync(
        'src/modules/authentication/infrastructure/persistence/registration.repository.ts',
        'utf8',
      ).split('async findActiveLoginIdentity')[0] ?? '';
    expect(source).toContain('identity.registration_attempts');
    expect(source).toContain('identity.otp_challenges');
    expect(source).toContain('identity.email_outbox');
    expect(source).toContain('audit.security_events');
    expect(source).not.toContain('tenancy.tenants');
    expect(source).not.toContain('identity.user_accounts');
  });
});
