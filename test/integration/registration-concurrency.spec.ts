import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
describe('registration concurrency safeguards', () => {
  it('delegates final identity conflicts to global unique constraints inside one transaction', () => {
    const constraints = readFileSync('database/schema/030_constraints.sql', 'utf8');
    expect(constraints).toContain('tenants_slug_unique UNIQUE (slug)');
    expect(constraints).toContain('users_email_unique UNIQUE (normalized_email)');
    const useCase = readFileSync(
      'src/modules/authentication/application/use-cases/verify-registration-otp.use-case.ts',
      'utf8',
    );
    expect(useCase).toMatch(/code\s*===\s*'23505'/);
    expect(useCase.indexOf('tokens.issue')).toBeGreaterThan(useCase.indexOf('this.tx.run'));
  });
});
