import { Body, Controller, Headers, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApplicationError } from '../../../../shared/http/application-error.js';
import type { VerifyLoginOtpUseCase } from '../../application/use-cases/verify-login-otp.use-case.js';
import type { VerifyRegistrationOtpUseCase } from '../../application/use-cases/verify-registration-otp.use-case.js';
import { otpVerificationSchema } from './dto/schemas.js';
export const VERIFY_REGISTRATION_OTP = Symbol('VERIFY_REGISTRATION_OTP'),
  VERIFY_LOGIN_OTP = Symbol('VERIFY_LOGIN_OTP');
@Controller('v1/auth')
export class OtpVerificationController {
  constructor(
    @Inject(VERIFY_REGISTRATION_OTP) private readonly registration: VerifyRegistrationOtpUseCase,
    @Inject(VERIFY_LOGIN_OTP) private readonly login: VerifyLoginOtpUseCase,
  ) {}
  @Post('otp-verifications') async verify(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const parsed = otpVerificationSchema.safeParse(body);
    if (!parsed.success)
      throw new ApplicationError(422, 'validation_failed', 'Invalid verification data');
    const common = {
      challengeId: parsed.data.challenge_id,
      code: parsed.data.code,
      correlationId: correlationId ?? request.id,
    };
    try {
      const result = await this.registration.execute(common);
      return {
        access_token: result.accessToken,
        token_type: result.tokenType,
        expires_in: result.expiresIn,
      };
    } catch (error) {
      if (!(error instanceof ApplicationError) || error.status !== 401) throw error;
      const result = await this.login.execute({ ...common, ip: request.ip });
      return {
        access_token: result.accessToken,
        token_type: result.tokenType,
        expires_in: result.expiresIn,
      };
    }
  }
}
