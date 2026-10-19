import { Catch } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApplicationError } from '../../../../shared/application/application-error.js';

@Catch()
export class SchedulingExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const code = (exception as { code?: string } | null)?.code;
    const error = exception instanceof ApplicationError ? exception :
      code === '23P01' || code === '23505' ? new ApplicationError(409, 'conflict', 'Scheduling conflict') :
      code === '23503' ? new ApplicationError(404, 'not_found', 'Resource not found') :
      new ApplicationError(500, 'internal_error', 'Unexpected failure');
    if (error.retryAfterSeconds !== undefined) response.header('Retry-After',String(error.retryAfterSeconds));
    void response.status(error.status).type('application/problem+json').send({
      type: `https://barber-calendar.local/problems/${error.code}`, title: error.message,
      status: error.status, code: error.code, correlation_id: request.id,
    });
  }
}
