import type { PoolClient } from 'pg';

export interface ClientPool {
  connect(): Promise<PoolClient>;
}

export class TransactionRunner {
  constructor(private readonly pool: ClientPool) {}
  async run<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* preserve the original error */
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
