import { Module } from '@nestjs/common';
import type { Environment } from '../../shared/config/environment.schema.js';
import { ENVIRONMENT } from '../../shared/config/config.module.js';
import { SystemClock } from '../../shared/application/ports/clock.js';
import { PostgresPool } from '../../shared/database/postgres-pool.js';
import { TransactionRunner } from '../../shared/database/transaction-runner.js';
import { CryptoOtpAdapter } from '../../shared/infrastructure/crypto/otp-crypto.adapter.js';
import { OutboxCryptoAdapter } from '../../shared/infrastructure/crypto/outbox-crypto.adapter.js';
import { StartRegistrationUseCase } from './application/use-cases/start-registration.use-case.js';
import { RequestLoginOtpUseCase } from './application/use-cases/request-login-otp.use-case.js';
import { VerifyRegistrationOtpUseCase } from './application/use-cases/verify-registration-otp.use-case.js';
import { VerifyLoginOtpUseCase } from './application/use-cases/verify-login-otp.use-case.js';
import { OtpThrottleService } from './application/services/otp-throttle.service.js';
import { RegistrationRepository } from './infrastructure/persistence/registration.repository.js';
import { ThrottleRepository } from './infrastructure/persistence/throttle.repository.js';
import { JwtTokenAdapter } from './infrastructure/token/jwt-token.adapter.js';
import {
  RegistrationController,
  START_REGISTRATION,
} from './infrastructure/http/registration.controller.js';
import {
  OtpRequestController,
  REQUEST_LOGIN_OTP,
} from './infrastructure/http/otp-request.controller.js';
import {
  OtpVerificationController,
  VERIFY_LOGIN_OTP,
  VERIFY_REGISTRATION_OTP,
} from './infrastructure/http/otp-verification.controller.js';
import { TENANT_REPOSITORY, TOKEN_VERIFIER } from './infrastructure/http/tenant-session.guard.js';
import { TenantRepository } from '../tenancy/infrastructure/persistence/tenant.repository.js';
import { MailpitEmailSender } from '../notifications/infrastructure/email/mailpit-email-sender.js';
import { BrevoEmailSender } from '../notifications/infrastructure/email/brevo-email-sender.js';
import { OutboxDispatcher } from '../outbox/infrastructure/outbox-dispatcher.js';

export const DATABASE = Symbol('DATABASE'),
  TRANSACTIONS = Symbol('TRANSACTIONS'),
  OTP_CRYPTO = Symbol('OTP_CRYPTO'),
  OUTBOX_CRYPTO = Symbol('OUTBOX_CRYPTO'),
  CLOCK = Symbol('CLOCK'),
  REGISTRATION_REPOSITORY = Symbol('REGISTRATION_REPOSITORY'),
  THROTTLE = Symbol('THROTTLE'),
  TOKEN_ADAPTER = Symbol('TOKEN_ADAPTER'),
  EMAIL_SENDER = Symbol('EMAIL_SENDER'),
  OUTBOX_DISPATCHER = Symbol('OUTBOX_DISPATCHER');

@Module({
  controllers: [RegistrationController, OtpRequestController, OtpVerificationController],
  providers: [
    {
      provide: DATABASE,
      inject: [ENVIRONMENT],
      useFactory: (env: Environment) =>
        new PostgresPool({ connectionString: env.DATABASE_URL, max: 20 }),
    },
    {
      provide: TRANSACTIONS,
      inject: [DATABASE],
      useFactory: (db: PostgresPool) => new TransactionRunner(db),
    },
    { provide: CLOCK, useFactory: () => new SystemClock() },
    {
      provide: OTP_CRYPTO,
      inject: [ENVIRONMENT],
      useFactory: (env: Environment) => new CryptoOtpAdapter(env.OTP_HMAC_KEY),
    },
    {
      provide: OUTBOX_CRYPTO,
      inject: [ENVIRONMENT],
      useFactory: (env: Environment) => new OutboxCryptoAdapter(env.OUTBOX_ENCRYPTION_KEY),
    },
    { provide: REGISTRATION_REPOSITORY, useFactory: () => new RegistrationRepository() },
    {
      provide: THROTTLE,
      inject: [ENVIRONMENT],
      useFactory: (env: Environment) =>
        new OtpThrottleService(new ThrottleRepository(), env.THROTTLE_HMAC_KEY),
    },
    {
      provide: TOKEN_ADAPTER,
      inject: [ENVIRONMENT],
      useFactory: (env: Environment) =>
        new JwtTokenAdapter({
          privateKey: env.JWT_PRIVATE_KEY,
          publicKey: env.JWT_PUBLIC_KEY,
          kid: env.JWT_KEY_ID,
          issuer: env.JWT_ISSUER,
          audience: env.JWT_AUDIENCE,
        }),
    },
    { provide: TOKEN_VERIFIER, useExisting: TOKEN_ADAPTER },
    {
      provide: TENANT_REPOSITORY,
      inject: [DATABASE],
      useFactory: (db: PostgresPool) => new TenantRepository(db),
    },
    {
      provide: EMAIL_SENDER,
      inject: [ENVIRONMENT],
      useFactory: (env: Environment) =>
        env.EMAIL_PROVIDER === 'brevo'
          ? new BrevoEmailSender(env.BREVO_API_KEY ?? '', {
              email: 'no-reply@barber-calendar.local',
              name: 'Barber Calendar',
            })
          : new MailpitEmailSender(),
    },
    {
      provide: START_REGISTRATION,
      inject: [
        TRANSACTIONS,
        REGISTRATION_REPOSITORY,
        OTP_CRYPTO,
        OUTBOX_CRYPTO,
        THROTTLE,
        CLOCK,
        ENVIRONMENT,
      ],
      useFactory: (
        tx: TransactionRunner,
        repo: RegistrationRepository,
        otp: CryptoOtpAdapter,
        outbox: OutboxCryptoAdapter,
        throttle: OtpThrottleService,
        clock: SystemClock,
        env: Environment,
      ) => new StartRegistrationUseCase(tx, repo, otp, outbox, throttle, clock, env.EMAIL_PROVIDER),
    },
    {
      provide: REQUEST_LOGIN_OTP,
      inject: [
        TRANSACTIONS,
        REGISTRATION_REPOSITORY,
        OTP_CRYPTO,
        OUTBOX_CRYPTO,
        THROTTLE,
        CLOCK,
        ENVIRONMENT,
      ],
      useFactory: (
        tx: TransactionRunner,
        repo: RegistrationRepository,
        otp: CryptoOtpAdapter,
        outbox: OutboxCryptoAdapter,
        throttle: OtpThrottleService,
        clock: SystemClock,
        env: Environment,
      ) => new RequestLoginOtpUseCase(tx, repo, otp, outbox, throttle, clock, env.EMAIL_PROVIDER),
    },
    {
      provide: VERIFY_REGISTRATION_OTP,
      inject: [
        TRANSACTIONS,
        REGISTRATION_REPOSITORY,
        OTP_CRYPTO,
        TOKEN_ADAPTER,
        CLOCK,
        ENVIRONMENT,
      ],
      useFactory: (
        tx: TransactionRunner,
        repo: RegistrationRepository,
        otp: CryptoOtpAdapter,
        tokens: JwtTokenAdapter,
        clock: SystemClock,
        env: Environment,
      ) => new VerifyRegistrationOtpUseCase(tx, repo, otp, tokens, clock, env.AUTH_SESSION_TTL),
    },
    {
      provide: VERIFY_LOGIN_OTP,
      inject: [
        TRANSACTIONS,
        REGISTRATION_REPOSITORY,
        OTP_CRYPTO,
        TOKEN_ADAPTER,
        THROTTLE,
        CLOCK,
        ENVIRONMENT,
      ],
      useFactory: (
        tx: TransactionRunner,
        repo: RegistrationRepository,
        otp: CryptoOtpAdapter,
        tokens: JwtTokenAdapter,
        throttle: OtpThrottleService,
        clock: SystemClock,
        env: Environment,
      ) => new VerifyLoginOtpUseCase(tx, repo, otp, tokens, throttle, clock, env.AUTH_SESSION_TTL),
    },
    {
      provide: OUTBOX_DISPATCHER,
      inject: [DATABASE, TRANSACTIONS, OUTBOX_CRYPTO, EMAIL_SENDER],
      useFactory: (
        db: PostgresPool,
        tx: TransactionRunner,
        crypto: OutboxCryptoAdapter,
        email: MailpitEmailSender | BrevoEmailSender,
      ) => new OutboxDispatcher(db, tx, crypto, email),
    },
  ],
  exports: [DATABASE, OUTBOX_DISPATCHER, TOKEN_VERIFIER, TENANT_REPOSITORY],
})
export class AuthenticationModule {}
