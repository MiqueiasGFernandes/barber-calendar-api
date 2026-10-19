import type {
  SecurityEventWriter,
  SecurityEvent,
} from '../../../shared/application/ports/security-event-writer.js';
import type { Queryable } from '../../../shared/database/postgres-pool.js';

export class PostgresSecurityEventWriter implements SecurityEventWriter {
  constructor(private readonly database: Queryable) {}

  async write(event: SecurityEvent): Promise<void> {
    await this.database.query(
      `INSERT INTO audit.security_events
      (id,event_type,outcome,occurred_at,correlation_id,tenant_id,actor_user_id,challenge_id,session_id,reason_code,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [
        event.id,
        event.eventType,
        event.outcome,
        event.occurredAt,
        event.correlationId,
        event.tenantId ?? null,
        event.actorUserId ?? null,
        event.challengeId ?? null,
        event.sessionId ?? null,
        event.reasonCode ?? null,
        JSON.stringify(event.metadata ?? {}),
      ],
    );
  }
}
