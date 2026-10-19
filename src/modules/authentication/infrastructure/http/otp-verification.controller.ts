import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApplicationError } from '../../../../shared/application/application-error.js';
import type { VerifyOtpUseCase } from '../../application/use-cases/verify-otp.use-case.js';
import { otpVerificationSchema } from './dto/schemas.js';
export const VERIFY_OTP = Symbol('VERIFY_OTP');
@Controller('v1/auth')
export class OtpVerificationController {
  constructor(@Inject(VERIFY_OTP) private readonly verification: VerifyOtpUseCase) {}
  @Post('otp-verifications') async verify(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = otpVerificationSchema.safeParse(body);
    if (!parsed.success)
      throw new ApplicationError(422, 'validation_failed', 'Invalid verification data');
    const common = {
      challengeId: parsed.data.challenge_id,
      code: parsed.data.code,
      ip: request.ip,
      correlationId: request.id,
    };
    const result = await this.verification.execute(common);
    return {
      access_token: result.accessToken,
      token_type: result.tokenType,
      expires_in: result.expiresIn,
    };
  }
}
