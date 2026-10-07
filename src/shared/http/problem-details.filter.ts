import { Catch } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApplicationError } from './application-error.js';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>(),
      request = host.switchToHttp().getRequest<FastifyRequest>();
    const error =
      exception instanceof ApplicationError
        ? exception
        : new ApplicationError(500, 'internal_error', 'Unexpected failure');
    const correlationId = String(request.headers['x-correlation-id'] ?? request.id);
    if (error.retryAfterSeconds !== undefined)
      response.header('Retry-After', String(error.retryAfterSeconds));
    void response
      .status(error.status)
      .type('application/problem+json')
      .send({
        type: `https://barber-calendar.local/problems/${error.code}`,
        title: error.message,
        status: error.status,
        code: error.code,
        correlation_id: correlationId,
        ...(error.retryAfterSeconds === undefined
          ? {}
          : { retry_after_seconds: error.retryAfterSeconds }),
      });
  }
}
