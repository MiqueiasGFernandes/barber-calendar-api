import { SignJWT, importPKCS8, importSPKI, jwtVerify } from 'jose';
import type {
  SessionClaims,
  TokenIssuer,
  TokenVerifier,
} from '../../../../shared/application/ports/token.js';

export class JwtTokenAdapter implements TokenIssuer, TokenVerifier {
  private signingKey?: ReturnType<typeof importPKCS8>;
  private verificationKey?: ReturnType<typeof importSPKI>;
  constructor(
    private readonly config: {
      privateKey: string;
      publicKey: string;
      kid: string;
      issuer: string;
      audience: string;
    },
  ) {}
  async issue(c: SessionClaims): Promise<string> {
    this.signingKey ??= importPKCS8(this.config.privateKey.replace(/\\n/g, '\n'), 'RS256');
    return new SignJWT({
      sid: c.sid,
      jti: c.jti,
      tenant_id: c.tenantId,
      membership_id: c.membershipId,
      role: c.role,
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.config.kid, typ: 'JWT' })
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setSubject(c.sub)
      .setIssuedAt(Math.floor(c.issuedAt.getTime() / 1000))
      .setExpirationTime(Math.floor(c.expiresAt.getTime() / 1000))
      .sign(await this.signingKey);
  }
  async verify(token: string): Promise<SessionClaims> {
    this.verificationKey ??= importSPKI(this.config.publicKey.replace(/\\n/g, '\n'), 'RS256');
    const { payload } = await jwtVerify(token, await this.verificationKey, {
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: ['RS256'],
    });
    if (
      !payload.sub ||
      typeof payload.sid !== 'string' ||
      typeof payload.jti !== 'string' ||
      typeof payload.tenant_id !== 'string' ||
      typeof payload.membership_id !== 'string' ||
      typeof payload.role !== 'string' ||
      !payload.iat ||
      !payload.exp
    )
      throw new Error('incomplete token');
    if (payload.role !== 'administrator' && payload.role !== 'member')
      throw new Error('invalid role');
    return {
      sub: payload.sub,
      sid: payload.sid,
      jti: payload.jti,
      tenantId: payload.tenant_id,
      membershipId: payload.membership_id,
      role: payload.role,
      issuedAt: new Date(payload.iat * 1000),
      expiresAt: new Date(payload.exp * 1000),
    };
  }
}
