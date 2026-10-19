import type { EmailSender } from '../../../shared/application/ports/email-sender.js';
import type { Queryable } from '../../../shared/database/postgres-pool.js';
import type { TransactionRunner } from '../../../shared/database/transaction-runner.js';
import type { OutboxCryptoAdapter } from '../../../shared/infrastructure/crypto/outbox-crypto.adapter.js';
import { randomUUID } from 'node:crypto';
import type { Telemetry } from '../../../shared/observability/telemetry.js';

interface LeasedItem {
  id: string;
  challengeId: string;
  envelope: Buffer;
  attemptCount: number;
  createdAt: Date;
}
export class OutboxDispatcher {
  constructor(
    private readonly database: Queryable,
    private readonly tx: TransactionRunner,
    private readonly crypto: OutboxCryptoAdapter,
    private readonly sender: EmailSender,
    private readonly telemetry?: Telemetry,
  ) {}
  async dispatch(batchSize = 20): Promise<number> {
    const items = await this.tx.run(async (client) => {
      const result = await client.query<LeasedItem>(
        `SELECT o.id,o.challenge_id AS "challengeId",o.envelope_ciphertext AS envelope,o.attempt_count AS "attemptCount",o.created_at AS "createdAt"
      FROM identity.email_outbox o JOIN identity.otp_challenges c ON c.id=o.challenge_id
      WHERE ((o.status IN ('pending','retryable') AND o.next_attempt_at<=clock_timestamp())
        OR (o.status='leased' AND o.leased_until<=clock_timestamp()))
      FOR UPDATE OF o SKIP LOCKED LIMIT $1`,
        [batchSize],
      );
      for (const item of result.rows)
        await client.query(
          `UPDATE identity.email_outbox SET status='leased',leased_until=clock_timestamp()+interval '1 minute' WHERE id=$1`,
          [item.id],
        );
      return result.rows;
    });
    for (const item of items) {
      const valid = await this.database.query(
        `SELECT 1 FROM identity.otp_challenges WHERE id=$1 AND status='pending' AND expires_at>clock_timestamp()`,
        [item.challengeId],
      );
      const deliveryStarted = performance.now();
      const ageSeconds = Math.max(0, (Date.now() - new Date(item.createdAt).getTime()) / 1000);
      if ((valid.rowCount ?? 0) === 0) {
        await this.terminal(item.id, 'expired');
        const context = await this.recordEvent(
          item.challengeId,
          'failed',
          'challenge_expired',
        ).catch(() => undefined);
        if (context)
          this.telemetry?.outbox(
            context,
            'expired',
            ageSeconds,
            (performance.now() - deliveryStarted) / 1000,
          );
        continue;
      }
      try {
        const envelope = this.crypto.decrypt(item.envelope);
        const sent = await this.sender.send({ ...envelope, idempotencyKey: item.id });
        await this.database.query(
          `UPDATE identity.email_outbox SET status='delivered',provider_message_id=$2,delivered_at=clock_timestamp(),envelope_ciphertext=NULL,payload_purged_at=clock_timestamp() WHERE id=$1`,
          [item.id, sent.messageId],
        );
        const context = await this.recordEvent(item.challengeId, 'succeeded', 'delivered').catch(
          () => undefined,
        );
        if (context)
          this.telemetry?.outbox(
            context,
            'delivered',
            ageSeconds,
            (performance.now() - deliveryStarted) / 1000,
          );
      } catch {
        const attempts = item.attemptCount + 1;
        if (attempts >= 5) {
          await this.terminal(item.id, 'failed');
          const context = await this.recordEvent(
            item.challengeId,
            'failed',
            'terminal_delivery_failure',
          ).catch(() => undefined);
          if (context)
            this.telemetry?.outbox(
              context,
              'terminal_failure',
              ageSeconds,
              (performance.now() - deliveryStarted) / 1000,
            );
        } else {
          await this.database.query(
            `UPDATE identity.email_outbox SET status='retryable',attempt_count=$2::integer,next_attempt_at=clock_timestamp()+($2::integer*$2::integer)*interval '30 seconds',leased_until=NULL WHERE id=$1`,
            [item.id, attempts],
          );
          const context = await this.recordEvent(
            item.challengeId,
            'failed',
            'retryable_delivery_failure',
          ).catch(() => undefined);
          if (context)
            this.telemetry?.outbox(
              context,
              'retry',
              ageSeconds,
              (performance.now() - deliveryStarted) / 1000,
            );
        }
      }
    }
    return items.length;
  }
  private async terminal(id: string, status: 'failed' | 'expired'): Promise<void> {
    await this.database.query(
      `UPDATE identity.email_outbox SET status=$2,failed_at=CASE WHEN $2='failed' THEN clock_timestamp() ELSE failed_at END,envelope_ciphertext=NULL,payload_purged_at=clock_timestamp(),leased_until=NULL WHERE id=$1`,
      [id, status],
    );
  }

  private async recordEvent(
    challengeId: string,
    outcome: 'succeeded' | 'failed',
    reasonCode: string,
  ): Promise<{ correlationId: string; tenantId?: string } | undefined> {
    const source = await this.database.query<{
      correlation_id: string;
      tenant_id: string | null;
      actor_user_id: string | null;
    }>(
      `SELECT correlation_id,tenant_id,actor_user_id FROM audit.security_events
      WHERE challenge_id=$1 ORDER BY occurred_at ASC LIMIT 1`,
      [challengeId],
    );
    const context = source.rows[0];
    if (!context) return undefined;
    await this.database.query(
      `INSERT INTO audit.security_events(id,event_type,outcome,occurred_at,correlation_id,tenant_id,actor_user_id,challenge_id,reason_code)
      VALUES($1,'email_delivery',$2,clock_timestamp(),$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        outcome,
        context.correlation_id,
        context.tenant_id,
        context.actor_user_id,
        challengeId,
        reasonCode,
      ],
    );
    return {
      correlationId: context.correlation_id,
      ...(context.tenant_id ? { tenantId: context.tenant_id } : {}),
    };
  }
}
