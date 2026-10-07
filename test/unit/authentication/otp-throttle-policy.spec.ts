import { describe, expect, it, vi } from 'vitest';
import type { Queryable } from '../../../src/shared/database/postgres-pool.js';
import { OtpThrottleService } from '../../../src/modules/authentication/application/services/otp-throttle.service.js';
import type { ThrottleRepository } from '../../../src/modules/authentication/infrastructure/persistence/throttle.repository.js';
describe('OTP throttle policy', () => {
  it('uses opaque stable subjects and separates scopes', () => {
    const service = new OtpThrottleService({} as ThrottleRepository, 'k'.repeat(32));
    expect(service.digest('tenant\0email')).toHaveLength(32);
    expect(service.digest('tenant\0email').equals(service.digest('tenant\0email'))).toBe(true);
    expect(service.digest('tenant\0email').equals(service.digest('ip'))).toBe(false);
  });
  it('returns a uniform rate-limit error', async () => {
    const consume = vi.fn().mockResolvedValue(37),
      service = new OtpThrottleService(
        { consume } as unknown as ThrottleRepository,
        'k'.repeat(32),
      );
    await expect(
      service.enforce({} as Queryable, {
        tenantSlug: 'tenant',
        email: 'a@b.test',
        ip: '127.0.0.1',
        action: 'otp_issue',
        now: new Date(),
      }),
    ).rejects.toMatchObject({ status: 429, code: 'too_many_requests', retryAfterSeconds: 37 });
    const subjects = consume.mock.calls[0]?.[1] as { limit: { maximum: number } }[];
    expect(subjects.map((s) => s.limit.maximum)).toEqual([5, 20]);
  });
});
