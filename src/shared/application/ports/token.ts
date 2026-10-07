export interface SessionClaims {
  sub: string;
  sid: string;
  jti: string;
  tenantId: string;
  membershipId: string;
  role: 'administrator' | 'member';
  issuedAt: Date;
  expiresAt: Date;
}
export interface TokenIssuer {
  issue(claims: SessionClaims): Promise<string>;
}
export interface TokenVerifier {
  verify(token: string): Promise<SessionClaims>;
}
