import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../../../shared/database/postgres-pool.js';

export type ThrottleAction = 'registration' | 'otp_issue' | 'otp_verify_failure';
export interface ThrottleLimit {
  windowSeconds: number;
  maximum: number;
}
export class ThrottleRepository {
  async consume(
    client: Queryable,
    subjects: readonly { scopeType: 'tenant_email' | 'ip'; digest: Buffer; limit: ThrottleLimit }[],
    action: ThrottleAction,
    now: Date,
  ): Promise<number | null> {
    const locked = [] as { id: string; limit: ThrottleLimit }[];
    for (const subject of [...subjects].sort((a, b) => Buffer.compare(a.digest, b.digest))) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO identity.throttle_subjects(id,scope_type,scope_digest,created_at) VALUES ($1,$2,$3,$4) ON CONFLICT(scope_type,scope_digest) DO UPDATE SET scope_type=EXCLUDED.scope_type RETURNING id`,
        [randomUUID(), subject.scopeType, subject.digest, now],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('throttle subject unavailable');
      await client.query('SELECT id FROM identity.throttle_subjects WHERE id=$1 FOR UPDATE', [id]);
      locked.push({ id, limit: subject.limit });
    }
    let retryAfter: number | null = null;
    for (const item of locked) {
      const since = new Date(now.getTime() - item.limit.windowSeconds * 1000);
      const result = await client.query<{ count: string; oldest: Date | null }>(
        `SELECT count(*)::text AS count,min(occurred_at) AS oldest FROM identity.throttle_events WHERE subject_id=$1 AND action=$2 AND occurred_at>$3`,
        [item.id, action, since],
      );
      const row = result.rows[0];
      if (row && Number(row.count) >= item.limit.maximum && row.oldest) {
        retryAfter = Math.max(
          retryAfter ?? 0,
          Math.ceil(
            (row.oldest.getTime() + item.limit.windowSeconds * 1000 - now.getTime()) / 1000,
          ),
        );
      }
    }
    if (retryAfter !== null) return retryAfter;
    for (const item of locked)
      await client.query(
        `INSERT INTO identity.throttle_events(id,subject_id,action,occurred_at) VALUES ($1,$2,$3,$4)`,
        [randomUUID(), item.id, action, now],
      );
    return null;
  }
}
