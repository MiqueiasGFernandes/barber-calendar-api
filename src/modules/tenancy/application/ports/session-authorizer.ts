export interface AuthorizedSession {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: 'administrator' | 'member';
  expiresAt: Date;
}

export interface SessionAuthorizer {
  authorizeSession(sessionId: string, tenantId?: string): Promise<AuthorizedSession | null>;
}
