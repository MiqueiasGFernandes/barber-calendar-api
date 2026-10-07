import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
describe('login session concurrency', () => {
  it('locks challenges and creates independent session rows', () => {
    const repo = readFileSync(
      'src/modules/authentication/infrastructure/persistence/registration.repository.ts',
      'utf8',
    );
    expect(repo).toContain('FOR UPDATE');
    expect(repo).toContain('INSERT INTO identity.authenticated_sessions');
    expect(repo).not.toMatch(
      /UPDATE identity\.authenticated_sessions SET status='revoked'.*login/s,
    );
  });
});
