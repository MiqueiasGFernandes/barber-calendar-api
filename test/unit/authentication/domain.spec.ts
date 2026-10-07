import { describe, expect, it } from 'vitest';
import { RegistrationAttempt } from '../../../src/modules/authentication/domain/registration-attempt.js';
import { OtpChallenge } from '../../../src/modules/authentication/domain/otp-challenge.js';
describe('authentication domain', () => {
  it('only completes a pending unexpired registration', () => {
    const item = new RegistrationAttempt('id', new Date(1000));
    item.complete(new Date(999));
    expect(item.status).toBe('completed');
    expect(() => item.complete(new Date(999))).toThrow();
  });
  it('locks an OTP after five failures', () => {
    const otp = new OtpChallenge('id', 'login', new Date(10000));
    for (let i = 0; i < 5; i++) otp.fail(new Date(1));
    expect(otp.status).toBe('locked');
    expect(otp.failedAttempts).toBe(5);
  });
});
