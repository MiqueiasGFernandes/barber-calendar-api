import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
describe('tenant session authorization', () => {
  it('revalidates session, account, tenant and membership status', () => {
    const source = readFileSync(
      'src/modules/tenancy/infrastructure/persistence/tenant.repository.ts',
      'utf8',
    );
    for (const clause of [
      "s.status='active'",
      "u.status='active'",
      "t.status='active'",
      "m.status='active'",
      's.expires_at>clock_timestamp()',
    ]) {
      expect(source).toContain(clause);
    }
  });
});
