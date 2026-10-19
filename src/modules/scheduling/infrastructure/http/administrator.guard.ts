import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApplicationError } from '../../../../shared/application/application-error.js';
import type { AuthorizedSession } from '../../../tenancy/application/ports/session-authorizer.js';

@Injectable()
export class AdministratorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest & { auth?: AuthorizedSession }>();
    if (!request.auth) throw new ApplicationError(401, 'unauthorized', 'Unauthorized');
    if (request.auth.role !== 'administrator') throw new ApplicationError(403, 'forbidden', 'Forbidden');
    return true;
  }
}
