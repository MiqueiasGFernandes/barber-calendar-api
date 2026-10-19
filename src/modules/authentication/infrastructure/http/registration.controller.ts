import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApplicationError } from '../../../../shared/application/application-error.js';
import type { StartRegistrationUseCase } from '../../application/use-cases/start-registration.use-case.js';
import { registrationSchema } from './dto/schemas.js';
export const START_REGISTRATION = Symbol('START_REGISTRATION');
@Controller('v1/tenants')
export class RegistrationController {
  constructor(@Inject(START_REGISTRATION) private readonly useCase: StartRegistrationUseCase) {}
  @Post('register') @HttpCode(201) async register(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsed = registrationSchema.safeParse(body);
    if (!parsed.success)
      throw new ApplicationError(422, 'validation_failed', 'Invalid registration data');
    const result = await this.useCase.execute({
      tenantName: parsed.data.tenant_name,
      tenantSlug: parsed.data.tenant_slug,
      administratorEmail: parsed.data.administrator_email,
      ip: request.ip,
      correlationId: request.id,
    });
    reply.header('Location', `/v1/tenants/registration-attempts/${result.registrationAttemptId}`);
    return {
      registration_attempt_id: result.registrationAttemptId,
      status: result.status,
      challenge_id: result.challengeId,
      expires_in: result.expiresIn,
      resend_after: result.resendAfter,
    };
  }
}
