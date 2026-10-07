import type { PoolClient } from 'pg';

export interface ActiveLoginIdentity {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: 'administrator' | 'member';
  email: string;
}
export interface LockedChallenge {
  id: string;
  purpose: 'registration' | 'login';
  status: string;
  codeDigest: Buffer;
  keyVersion: number;
  expiresAt: Date;
  failedAttempts: number;
  registrationAttemptId: string | null;
  userId: string | null;
  tenantId: string | null;
  membershipId: string | null;
  normalizedEmail: string;
}

export class RegistrationRepository {
  async insertProvisional(
    client: PoolClient,
    input: {
      attemptId: string;
      challengeId: string;
      outboxId: string;
      eventId: string;
      correlationId: string;
      tenantName: string;
      tenantSlug: string;
      email: string;
      normalizedEmail: string;
      originDigest: Buffer;
      codeDigest: Buffer;
      keyVersion: number;
      issuedAt: Date;
      expiresAt: Date;
      attemptExpiresAt: Date;
      envelope: Buffer;
      envelopeKeyVersion: number;
      provider: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO identity.registration_attempts
      (id,tenant_name,tenant_slug,administrator_email,normalized_email,expires_at,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.attemptId,
        input.tenantName,
        input.tenantSlug,
        input.email,
        input.normalizedEmail,
        input.attemptExpiresAt,
        input.issuedAt,
      ],
    );
    await client.query(
      `INSERT INTO identity.otp_challenges
      (id,purpose,registration_attempt_id,normalized_email,origin_digest,code_digest,key_version,issued_at,expires_at)
      VALUES ($1,'registration',$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.challengeId,
        input.attemptId,
        input.normalizedEmail,
        input.originDigest,
        input.codeDigest,
        input.keyVersion,
        input.issuedAt,
        input.expiresAt,
      ],
    );
    await client.query(
      `INSERT INTO identity.email_outbox
      (id,challenge_id,kind,provider,envelope_ciphertext,encryption_key_version,created_at,next_attempt_at)
      VALUES ($1,$2,'registration_otp',$3,$4,$5,$6,$6)`,
      [
        input.outboxId,
        input.challengeId,
        input.provider,
        input.envelope,
        input.envelopeKeyVersion,
        input.issuedAt,
      ],
    );
    await client.query(
      `INSERT INTO audit.security_events
      (id,event_type,outcome,occurred_at,correlation_id,challenge_id,reason_code)
      VALUES ($1,'registration_requested','succeeded',$2,$3,$4,'verification_required')`,
      [input.eventId, input.issuedAt, input.correlationId, input.challengeId],
    );
  }

  async findActiveLoginIdentity(
    client: PoolClient,
    tenantSlug: string,
    normalizedEmail: string,
  ): Promise<ActiveLoginIdentity | null> {
    const result = await client.query<ActiveLoginIdentity>(
      `SELECT u.id AS "userId", t.id AS "tenantId", m.id AS "membershipId", m.role, u.email
      FROM tenancy.tenants t JOIN tenancy.tenant_memberships m ON m.tenant_id=t.id
      JOIN identity.user_accounts u ON u.id=m.user_id
      WHERE t.slug=$1 AND u.normalized_email=$2 AND t.status='active' AND u.status='active' AND m.status='active'`,
      [tenantSlug, normalizedEmail],
    );
    return result.rows[0] ?? null;
  }

  async supersedeLoginChallenges(
    client: PoolClient,
    userId: string,
    tenantId: string,
    now: Date,
  ): Promise<void> {
    await client.query(
      `UPDATE identity.otp_challenges SET status='superseded',superseded_at=$3
      WHERE purpose='login' AND user_id=$1 AND tenant_id=$2 AND status='pending'`,
      [userId, tenantId, now],
    );
  }

  async insertLoginChallenge(
    client: PoolClient,
    input: {
      challengeId: string;
      outboxId: string;
      eventId: string;
      correlationId: string;
      identity: ActiveLoginIdentity;
      normalizedEmail: string;
      originDigest: Buffer;
      codeDigest: Buffer;
      keyVersion: number;
      issuedAt: Date;
      expiresAt: Date;
      envelope: Buffer;
      envelopeKeyVersion: number;
      provider: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO identity.otp_challenges
      (id,purpose,user_id,tenant_id,membership_id,normalized_email,origin_digest,code_digest,key_version,issued_at,expires_at)
      VALUES ($1,'login',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.challengeId,
        input.identity.userId,
        input.identity.tenantId,
        input.identity.membershipId,
        input.normalizedEmail,
        input.originDigest,
        input.codeDigest,
        input.keyVersion,
        input.issuedAt,
        input.expiresAt,
      ],
    );
    await client.query(
      `INSERT INTO identity.email_outbox
      (id,challenge_id,kind,provider,envelope_ciphertext,encryption_key_version,created_at,next_attempt_at)
      VALUES ($1,$2,'login_otp',$3,$4,$5,$6,$6)`,
      [
        input.outboxId,
        input.challengeId,
        input.provider,
        input.envelope,
        input.envelopeKeyVersion,
        input.issuedAt,
      ],
    );
    await client.query(
      `INSERT INTO audit.security_events
      (id,event_type,outcome,occurred_at,correlation_id,tenant_id,actor_user_id,challenge_id,reason_code)
      VALUES ($1,'login_otp_requested','succeeded',$2,$3,$4,$5,$6,'accepted')`,
      [
        input.eventId,
        input.issuedAt,
        input.correlationId,
        input.identity.tenantId,
        input.identity.userId,
        input.challengeId,
      ],
    );
  }

  async lockChallenge(client: PoolClient, id: string): Promise<LockedChallenge | null> {
    const result = await client.query<LockedChallenge>(
      `SELECT id,purpose,status,code_digest AS "codeDigest",key_version AS "keyVersion",
      expires_at AS "expiresAt",failed_attempts AS "failedAttempts",registration_attempt_id AS "registrationAttemptId",
      user_id AS "userId",tenant_id AS "tenantId",membership_id AS "membershipId",normalized_email AS "normalizedEmail"
      FROM identity.otp_challenges WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async recordFailure(client: PoolClient, challenge: LockedChallenge, now: Date): Promise<void> {
    const failures = Math.min(challenge.failedAttempts + 1, 5);
    await client.query(
      `UPDATE identity.otp_challenges SET failed_attempts=$2::smallint,status=CASE WHEN $2::smallint>=5 THEN 'locked' ELSE status END,
      locked_at=CASE WHEN $2::smallint>=5 THEN $3 ELSE locked_at END WHERE id=$1`,
      [challenge.id, failures, now],
    );
  }

  async completeRegistration(
    client: PoolClient,
    challenge: LockedChallenge,
    now: Date,
    ids: {
      tenantId: string;
      userId: string;
      membershipId: string;
      sessionId: string;
      jti: string;
      eventId: string;
      correlationId: string;
    },
    expiresAt: Date,
  ): Promise<{ role: 'administrator' }> {
    const attempt = await client.query<{
      tenant_name: string;
      tenant_slug: string;
      administrator_email: string;
      normalized_email: string;
      status: string;
      expires_at: Date;
    }>(
      `SELECT tenant_name,tenant_slug,administrator_email,normalized_email,status,expires_at FROM identity.registration_attempts WHERE id=$1 FOR UPDATE`,
      [challenge.registrationAttemptId],
    );
    const row = attempt.rows[0];
    if (!row || row.status !== 'pending' || now >= row.expires_at)
      throw new Error('registration unavailable');
    await client.query(
      `INSERT INTO tenancy.tenants(id,name,slug,status,created_at,updated_at) VALUES ($1,$2,$3,'active',$4,$4)`,
      [ids.tenantId, row.tenant_name, row.tenant_slug, now],
    );
    await client.query(
      `INSERT INTO identity.user_accounts(id,email,normalized_email,email_verified_at,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'active',$4,$4)`,
      [ids.userId, row.administrator_email, row.normalized_email, now],
    );
    await client.query(
      `INSERT INTO tenancy.tenant_memberships(id,tenant_id,user_id,role,status,created_at,updated_at) VALUES ($1,$2,$3,'administrator','active',$4,$4)`,
      [ids.membershipId, ids.tenantId, ids.userId, now],
    );
    await this.insertSession(client, { ...ids, role: 'administrator', now, expiresAt });
    await client.query(
      `UPDATE identity.registration_attempts SET status='completed',completed_at=$2,tenant_id=$3,user_id=$4,membership_id=$5 WHERE id=$1`,
      [challenge.registrationAttemptId, now, ids.tenantId, ids.userId, ids.membershipId],
    );
    await this.consume(client, challenge.id, now);
    await this.insertSuccessEvent(client, {
      ...ids,
      challengeId: challenge.id,
      now,
      eventType: 'registration_completed',
    });
    return { role: 'administrator' };
  }

  async completeLogin(
    client: PoolClient,
    challenge: LockedChallenge,
    now: Date,
    ids: { sessionId: string; jti: string; eventId: string; correlationId: string },
    expiresAt: Date,
  ): Promise<{
    userId: string;
    tenantId: string;
    membershipId: string;
    role: 'administrator' | 'member';
  }> {
    const result = await client.query<{
      userId: string;
      tenantId: string;
      membershipId: string;
      role: 'administrator' | 'member';
    }>(
      `SELECT u.id AS "userId",t.id AS "tenantId",m.id AS "membershipId",m.role
      FROM identity.user_accounts u JOIN tenancy.tenant_memberships m ON m.user_id=u.id JOIN tenancy.tenants t ON t.id=m.tenant_id
      WHERE u.id=$1 AND t.id=$2 AND m.id=$3 AND u.status='active' AND t.status='active' AND m.status='active' FOR UPDATE OF u,m,t`,
      [challenge.userId, challenge.tenantId, challenge.membershipId],
    );
    const identity = result.rows[0];
    if (!identity) throw new Error('identity unavailable');
    await this.insertSession(client, { ...ids, ...identity, now, expiresAt });
    await this.consume(client, challenge.id, now);
    await this.insertSuccessEvent(client, {
      ...ids,
      ...identity,
      challengeId: challenge.id,
      now,
      eventType: 'login_completed',
    });
    return identity;
  }

  private async consume(client: PoolClient, id: string, now: Date): Promise<void> {
    await client.query(
      `UPDATE identity.otp_challenges SET status='consumed',consumed_at=$2 WHERE id=$1 AND status='pending'`,
      [id, now],
    );
  }
  private async insertSession(
    client: PoolClient,
    input: {
      sessionId: string;
      jti: string;
      userId: string;
      tenantId: string;
      membershipId: string;
      role: string;
      now: Date;
      expiresAt: Date;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO identity.authenticated_sessions(id,jti,user_id,tenant_id,membership_id,role,issued_at,expires_at,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$7)`,
      [
        input.sessionId,
        input.jti,
        input.userId,
        input.tenantId,
        input.membershipId,
        input.role,
        input.now,
        input.expiresAt,
      ],
    );
  }
  private async insertSuccessEvent(
    client: PoolClient,
    input: {
      eventId: string;
      correlationId: string;
      tenantId: string;
      userId: string;
      sessionId: string;
      challengeId: string;
      now: Date;
      eventType: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit.security_events(id,event_type,outcome,occurred_at,correlation_id,tenant_id,actor_user_id,challenge_id,session_id,reason_code) VALUES ($1,$2,'succeeded',$3,$4,$5,$6,$7,$8,'verified')`,
      [
        input.eventId,
        input.eventType,
        input.now,
        input.correlationId,
        input.tenantId,
        input.userId,
        input.challengeId,
        input.sessionId,
      ],
    );
  }
}
