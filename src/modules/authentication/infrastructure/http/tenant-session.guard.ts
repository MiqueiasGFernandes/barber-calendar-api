import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { TokenVerifier } from '../../../../shared/application/ports/token.js';
import { ApplicationError } from '../../../../shared/http/application-error.js';
import type { TenantRepository } from '../../../tenancy/infrastructure/persistence/tenant.repository.js';
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER'),
  TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');
@Injectable()
export class TenantSessionGuard implements CanActivate {
  constructor(
    @Inject(TOKEN_VERIFIER) private readonly tokens: TokenVerifier,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest & { auth?: unknown }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw new ApplicationError(401, 'unauthorized', 'Unauthorized');
    try {
      const claims = await this.tokens.verify(header.slice(7));
      const authorized = await this.tenants.authorizeSession(claims.sid, claims.tenantId);
      if (!authorized) throw new Error();
      request.auth = authorized;
      return true;
    } catch {
      throw new ApplicationError(401, 'unauthorized', 'Unauthorized');
    }
  }
}
