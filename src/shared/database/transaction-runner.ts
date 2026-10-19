import type { PoolClient } from 'pg';
import type { TransactionContext, TransactionManager } from '../application/ports/transaction.js';

export interface ClientPool {
  connect(): Promise<PoolClient>;
}

export class TransactionRunner implements TransactionManager {
  constructor(private readonly pool: ClientPool) {}
  async run<T>(operation: (context: TransactionContext) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const context: TransactionContext = {
        query: (text, values = []) => client.query(text, [...values]),
      };
      const result = await operation(context);
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
