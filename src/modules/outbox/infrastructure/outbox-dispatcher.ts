import type { EmailSender } from '../../../shared/application/ports/email-sender.js';
import type { Queryable } from '../../../shared/database/postgres-pool.js';
import type { TransactionRunner } from '../../../shared/database/transaction-runner.js';
import type { OutboxCryptoAdapter } from '../../../shared/infrastructure/crypto/outbox-crypto.adapter.js';

interface LeasedItem {
  id: string;
  challengeId: string;
  envelope: Buffer;
  attemptCount: number;
}
export class OutboxDispatcher {
  constructor(
    private readonly database: Queryable,
    private readonly tx: TransactionRunner,
    private readonly crypto: OutboxCryptoAdapter,
    private readonly sender: EmailSender,
  ) {}
  async dispatch(batchSize = 20): Promise<number> {
    const items = await this.tx.run(async (client) => {
      const result = await client.query<LeasedItem>(
        `SELECT o.id,o.challenge_id AS "challengeId",o.envelope_ciphertext AS envelope,o.attempt_count AS "attemptCount"
      FROM identity.email_outbox o JOIN identity.otp_challenges c ON c.id=o.challenge_id
      WHERE o.status IN ('pending','retryable') AND o.next_attempt_at<=clock_timestamp() FOR UPDATE OF o SKIP LOCKED LIMIT $1`,
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
      if ((valid.rowCount ?? 0) === 0) {
        await this.terminal(item.id, 'expired');
        continue;
      }
      try {
        const envelope = this.crypto.decrypt(item.envelope);
        const sent = await this.sender.send({ ...envelope, idempotencyKey: item.id });
        await this.database.query(
          `UPDATE identity.email_outbox SET status='delivered',provider_message_id=$2,delivered_at=clock_timestamp(),envelope_ciphertext=NULL,payload_purged_at=clock_timestamp() WHERE id=$1`,
          [item.id, sent.messageId],
        );
      } catch {
        const attempts = item.attemptCount + 1;
        if (attempts >= 5) await this.terminal(item.id, 'failed');
        else
          await this.database.query(
            `UPDATE identity.email_outbox SET status='retryable',attempt_count=$2::integer,next_attempt_at=clock_timestamp()+($2::integer*$2::integer)*interval '30 seconds',leased_until=NULL WHERE id=$1`,
            [item.id, attempts],
          );
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
}
