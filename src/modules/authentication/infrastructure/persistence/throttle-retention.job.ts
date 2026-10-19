import type { TransactionManager } from '../../../../shared/application/ports/transaction.js';
export class ThrottleRetentionJob {
  constructor(private readonly transactions: TransactionManager) {}
  async purge(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 90 * 60 * 1000);
    return this.transactions.run(async (client) => {
      const lock = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_xact_lock(4815162342) AS locked',
      );
      if (!lock.rows[0]?.locked) return 0;
      const result = await client.query(
        'DELETE FROM identity.throttle_events WHERE occurred_at<$1',
        [cutoff],
      );
      return result.rowCount ?? 0;
    });
  }
}
