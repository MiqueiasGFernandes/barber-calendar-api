import { Body, Controller, Headers, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApplicationError } from '../../../../shared/http/application-error.js';
import type { RequestLoginOtpUseCase } from '../../application/use-cases/request-login-otp.use-case.js';
import { otpRequestSchema } from './dto/schemas.js';
export const REQUEST_LOGIN_OTP = Symbol('REQUEST_LOGIN_OTP');
@Controller('v1/auth')
export class OtpRequestController {
  constructor(@Inject(REQUEST_LOGIN_OTP) private readonly useCase: RequestLoginOtpUseCase) {}
  @Post('otp-requests') @HttpCode(202) async request(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const parsed = otpRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApplicationError(422, 'validation_failed', 'Invalid request');
    const result = await this.useCase.execute({
      tenantSlug: parsed.data.tenant_slug,
      email: parsed.data.email,
      ip: request.ip,
      correlationId: correlationId ?? request.id,
    });
    return {
      status: result.status,
      challenge_id: result.challengeId,
      expires_in: result.expiresIn,
      resend_after: result.resendAfter,
    };
  }
}
