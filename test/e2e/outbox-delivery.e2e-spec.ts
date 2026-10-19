import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { StartRegistrationUseCase } from '../../src/modules/authentication/application/use-cases/start-registration.use-case.js';
import { OutboxDispatcher } from '../../src/modules/outbox/infrastructure/outbox-dispatcher.js';
import {
  closeDatabase,
  clock,
  database,
  outbox,
  otp,
  pool,
  repository,
  resetDatabase,
  throttle,
  tx,
} from './support.js';
const enabled = Boolean(process.env.DATABASE_URL);
describe.runIf(enabled)('outbox delivery', () => {
  beforeEach(resetDatabase);
  it('delivers with outbox id as idempotency key and purges ciphertext', async () => {
    const started = await new StartRegistrationUseCase(
      tx,
      repository,
      otp,
      outbox,
      throttle,
      clock,
      'mailpit',
    ).execute({
      tenantName: 'Outbox',
      tenantSlug: 'outbox-shop',
      administratorEmail: 'outbox@example.test',
      ip: '203.0.113.4',
      correlationId: randomUUID(),
    });
    await pool.query(
      `UPDATE identity.email_outbox SET next_attempt_at=clock_timestamp() WHERE challenge_id=$1`,
      [started.challengeId],
    );
    const sent: string[] = [];
    const dispatcher = new OutboxDispatcher(database, tx, outbox, {
      send: async (message) => {
        sent.push(message.idempotencyKey);
        expect(message.text).toContain('123456');
        return { messageId: 'mail-1' };
      },
    });
    expect(await dispatcher.dispatch()).toBe(1);
    const row = (
      await pool.query(
        `SELECT id,status,envelope_ciphertext,payload_purged_at FROM identity.email_outbox WHERE challenge_id=$1`,
        [started.challengeId],
      )
    ).rows[0];
    expect(sent).toEqual([row.id]);
    expect(row.status).toBe('delivered');
    expect(row.envelope_ciphertext).toBeNull();
    expect(row.payload_purged_at).not.toBeNull();
    expect(
      (
        await pool.query(
          `SELECT count(*)::int count FROM audit.security_events WHERE challenge_id=$1 AND event_type='email_delivery' AND outcome='succeeded'`,
          [started.challengeId],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });
  it('retries transient failures and purges an expired challenge without sending', async () => {
    const started = await new StartRegistrationUseCase(
      tx,
      repository,
      otp,
      outbox,
      throttle,
      clock,
      'mailpit',
    ).execute({
      tenantName: 'Retry',
      tenantSlug: 'retry-shop',
      administratorEmail: 'retry@example.test',
      ip: '203.0.113.5',
      correlationId: randomUUID(),
    });
    await pool.query(
      `UPDATE identity.email_outbox SET next_attempt_at=clock_timestamp() WHERE challenge_id=$1`,
      [started.challengeId],
    );
    const failing = new OutboxDispatcher(database, tx, outbox, {
      send: async () => {
        throw new Error('temporary provider failure');
      },
    });
    await failing.dispatch();
    expect(
      (
        await pool.query<{ status: string; attempt_count: number; has_payload: boolean }>(
          `SELECT status,attempt_count,envelope_ciphertext IS NOT NULL has_payload FROM identity.email_outbox WHERE challenge_id=$1`,
          [started.challengeId],
        )
      ).rows[0],
    ).toEqual({ status: 'retryable', attempt_count: 1, has_payload: true });
    await pool.query(`UPDATE identity.otp_challenges SET status='expired' WHERE id=$1`, [
      started.challengeId,
    ]);
    await pool.query(
      `UPDATE identity.email_outbox SET next_attempt_at=clock_timestamp() WHERE challenge_id=$1`,
      [started.challengeId],
    );
    await failing.dispatch();
    expect(
      (
        await pool.query<{ status: string; envelope_ciphertext: Buffer | null }>(
          `SELECT status,envelope_ciphertext FROM identity.email_outbox WHERE challenge_id=$1`,
          [started.challengeId],
        )
      ).rows[0],
    ).toEqual({ status: 'expired', envelope_ciphertext: null });
  });
  it('recovers an expired worker lease and delivers the item', async () => {
    const started = await new StartRegistrationUseCase(
      tx,
      repository,
      otp,
      outbox,
      throttle,
      clock,
      'mailpit',
    ).execute({
      tenantName: 'Lease',
      tenantSlug: 'lease-shop',
      administratorEmail: 'lease@example.test',
      ip: '203.0.113.6',
      correlationId: randomUUID(),
    });
    await pool.query(
      `UPDATE identity.email_outbox SET status='leased',leased_until=clock_timestamp()-interval '1 second' WHERE challenge_id=$1`,
      [started.challengeId],
    );
    let sent = 0;
    const dispatcher = new OutboxDispatcher(database, tx, outbox, {
      send: async () => {
        sent++;
        return { messageId: 'lease-recovered' };
      },
    });
    expect(await dispatcher.dispatch()).toBe(1);
    expect(sent).toBe(1);
    expect(
      (
        await pool.query(`SELECT status FROM identity.email_outbox WHERE challenge_id=$1`, [
          started.challengeId,
        ])
      ).rows[0]?.status,
    ).toBe('delivered');
  });
  afterAll(closeDatabase);
});
