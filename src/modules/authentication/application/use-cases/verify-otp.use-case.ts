import { ApplicationError } from '../../../../shared/application/application-error.js';
import type { TransactionManager } from '../../../../shared/application/ports/transaction.js';
import type { AuthenticationRepository } from '../ports/authentication.repository.js';
import type { VerifyLoginOtpUseCase } from './verify-login-otp.use-case.js';
import type { VerifyRegistrationOtpUseCase } from './verify-registration-otp.use-case.js';

export interface VerifyOtpInput {
  challengeId: string;
  code: string;
  ip: string;
  correlationId: string;
}

export class VerifyOtpUseCase {
  constructor(
    private readonly tx: TransactionManager,
    private readonly repository: AuthenticationRepository,
    private readonly registration: VerifyRegistrationOtpUseCase,
    private readonly login: VerifyLoginOtpUseCase,
  ) {}

  async execute(input: VerifyOtpInput) {
    const purpose = await this.tx.run((context) =>
      this.repository.findChallengePurpose(context, input.challengeId),
    );
    if (purpose === 'registration') return this.registration.execute(input);
    if (purpose === 'login') return this.login.execute(input);
    throw new ApplicationError(401, 'invalid_otp', 'Verification failed');
  }
}
