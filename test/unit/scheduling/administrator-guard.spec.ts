import { describe, expect, it } from 'vitest';
import { AdministratorGuard } from '../../../src/modules/scheduling/infrastructure/http/administrator.guard.js';
import { ApplicationError } from '../../../src/shared/application/application-error.js';

function context(auth?: { role: 'administrator' | 'member'; tenantId: string; membershipId: string }) {
  return { switchToHttp: () => ({ getRequest: () => ({ auth }) }) } as never;
}
describe('AdministratorGuard', () => {
  const guard = new AdministratorGuard();
  it('requires the authenticated session attached by TenantSessionGuard', () => {
    expect(() => guard.canActivate(context())).toThrow(ApplicationError);
    try { guard.canActivate(context()); } catch (error) { expect((error as ApplicationError).status).toBe(401); }
  });
  it('rejects a member role', () => {
    try { guard.canActivate(context({ role: 'member', tenantId: 't', membershipId: 'm' })); }
    catch (error) { expect((error as ApplicationError).status).toBe(403); return; }
    throw new Error('expected forbidden');
  });
  it('allows an active administrator session', () => {
    expect(guard.canActivate(context({ role: 'administrator', tenantId: 't', membershipId: 'm' }))).toBe(true);
  });
});
