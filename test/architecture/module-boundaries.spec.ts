import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
function files(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const item = join(path, name);
    return statSync(item).isDirectory() ? files(item) : item.endsWith('.ts') ? [item] : [];
  });
}
describe('module boundaries', () => {
  it('keeps domain and application independent from frameworks and persistence', () => {
    const candidates = files('src/modules').filter(
      (path) => path.includes('/domain/') || path.includes('/application/'),
    );
    for (const path of candidates) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/from ['"](?:@nestjs|@fastify|fastify|pg)/);
    }
  });
  it('does not contain ORM schema synchronization', () => {
    for (const path of files('src'))
      expect(readFileSync(path, 'utf8'), path).not.toMatch(
        /synchronize\s*:|migration:run|prisma\./i,
      );
  });
});
