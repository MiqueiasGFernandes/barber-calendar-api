import type { Queryable } from '../../../../shared/database/postgres-pool.js';
export class ThrottleRetentionJob {
  constructor(private readonly database: Queryable) {}
  async purge(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 90 * 60 * 1000);
    const result = await this.database.query(
      'DELETE FROM identity.throttle_events WHERE occurred_at<$1',
      [cutoff],
    );
    return result.rowCount ?? 0;
  }
}
