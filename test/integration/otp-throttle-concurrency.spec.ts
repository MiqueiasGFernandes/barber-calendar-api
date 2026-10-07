import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
describe('throttle concurrency', () => {
  it('locks subjects deterministically and counts moving windows atomically', () => {
    const source = readFileSync(
      'src/modules/authentication/infrastructure/persistence/throttle.repository.ts',
      'utf8',
    );
    expect(source).toMatch(/sort\(\(a,\s*b\)\s*=>\s*Buffer\.compare\(a\.digest,\s*b\.digest\)\)/);
    expect(source).toContain('FOR UPDATE');
    expect(source).toContain('occurred_at>$3');
    expect(source.indexOf('SELECT count')).toBeLessThan(
      source.indexOf('INSERT INTO identity.throttle_events'),
    );
  });
});
