import type { TransactionContext, QueryResult } from '../../../../shared/application/ports/transaction.js';
import type { SchedulingTransaction } from '../../application/ports/scheduling-transaction.js';
import type { ClientPool } from '../../../../shared/database/transaction-runner.js';

export class SchedulingTransactionAdapter implements SchedulingTransaction {
  constructor(private readonly pool: ClientPool) {}
  async run<T>(operation: (transaction: TransactionContext) => Promise<T>): Promise<T> {
    return this.withTransaction(operation);
  }
  async runForTenant<T>(tenantId: string, operation: (transaction: TransactionContext) => Promise<T>): Promise<T> {
    return this.withTransaction(async (transaction) => {
      const setting = await transaction.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM scheduling.tenant_settings WHERE tenant_id=$1 FOR UPDATE', [tenantId],
      );
      if (!setting.rows[0]) throw new Error('tenant settings unavailable');
      return operation(transaction);
    });
  }
  private async withTransaction<T>(operation: (transaction: TransactionContext) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      const context: TransactionContext = {
        query: async <R extends object>(text: string, values: readonly unknown[] = []): Promise<QueryResult<R>> => {
          const result = await client.query<R>(text, [...values]);
          return { rows: result.rows, rowCount: result.rowCount };
        },
      };
      const result = await operation(context);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the original failure */ }
      throw error;
    } finally {
      client.release();
    }
  }
}
