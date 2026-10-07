import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { TransactionRunner } from '../../../../src/shared/database/transaction-runner.js';
function fixture() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release = vi.fn(),
    client = { query, release } as unknown as PoolClient;
  return { query, release, runner: new TransactionRunner({ connect: async () => client }) };
}
describe('TransactionRunner', () => {
  it('commits and releases the same client', async () => {
    const f = fixture(),
      result = await f.runner.run(async (client) => {
        expect(client.query).toBeDefined();
        return 42;
      });
    expect(result).toBe(42);
    expect(f.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'COMMIT']);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it('rolls back, releases and preserves the error', async () => {
    const f = fixture(),
      failure = new Error('boom');
    await expect(
      f.runner.run(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(f.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(f.release).toHaveBeenCalledOnce();
  });
});
