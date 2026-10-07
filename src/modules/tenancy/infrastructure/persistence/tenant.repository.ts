import type { Queryable } from '../../../../shared/database/postgres-pool.js';

export interface AuthorizedSession {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: 'administrator' | 'member';
  expiresAt: Date;
}
export class TenantRepository {
  constructor(private readonly database: Queryable) {}
  async authorizeSession(sessionId: string, tenantId?: string): Promise<AuthorizedSession | null> {
    const result = await this.database.query<AuthorizedSession>(
      `SELECT s.user_id AS "userId",s.tenant_id AS "tenantId",s.membership_id AS "membershipId",m.role,s.expires_at AS "expiresAt"
      FROM identity.authenticated_sessions s JOIN identity.user_accounts u ON u.id=s.user_id
      JOIN tenancy.tenants t ON t.id=s.tenant_id JOIN tenancy.tenant_memberships m ON m.id=s.membership_id AND m.user_id=u.id AND m.tenant_id=t.id
      WHERE s.id=$1 AND ($2::uuid IS NULL OR t.id=$2) AND s.status='active' AND s.expires_at>clock_timestamp()
      AND u.status='active' AND t.status='active' AND m.status='active'`,
      [sessionId, tenantId ?? null],
    );
    return result.rows[0] ?? null;
  }
}
