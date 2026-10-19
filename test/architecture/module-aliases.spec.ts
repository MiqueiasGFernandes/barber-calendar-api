import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('ESM module aliases', () => {
  it('resolves scheduling and audit modules at runtime', async () => {
    expect(() => execFileSync('node', ['--input-type=module', '-e', "await import('#scheduling/scheduling.module.js'); await import('#audit/infrastructure/postgres-security-event-writer.js')"])).not.toThrow();
  });
});
