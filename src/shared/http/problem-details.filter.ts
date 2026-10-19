import { Catch } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApplicationError } from '../application/application-error.js';
import { JsonLogger } from '../observability/logger.js';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger = new JsonLogger()) {}
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>(),
      request = host.switchToHttp().getRequest<FastifyRequest>();
    const error =
      exception instanceof ApplicationError
        ? exception
        : new ApplicationError(500, 'internal_error', 'Unexpected failure');
    const correlationId = request.id;
    if (error.status >= 500)
      this.logger.logError('http_request_failed', exception, {
        correlation_id: correlationId,
        status_code: error.status,
        stage: 'request',
        component: 'api',
      });
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
