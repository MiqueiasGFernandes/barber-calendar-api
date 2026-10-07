import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
const api = YAML.parse(
  readFileSync('specs/001-tenant-authentication/contracts/openapi.yaml', 'utf8'),
) as Record<string, any>;
describe('registration OpenAPI contract', () => {
  it('defines strict registration and verification requests', () => {
    const register = api.paths['/tenants/register'].post;
    expect(Object.keys(register.responses)).toEqual(
      expect.arrayContaining(['201', '409', '422', '429']),
    );
    const schema = api.components.schemas.TenantRegistrationRequest;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['tenant_name', 'tenant_slug', 'administrator_email']);
    const verify = api.paths['/auth/otp-verifications'].post;
    expect(Object.keys(verify.responses)).toEqual(
      expect.arrayContaining(['200', '401', '409', '422', '429']),
    );
  });
  it('uses Problem Details and a location header', () => {
    expect(api.paths['/tenants/register'].post.responses['201'].headers.Location).toBeDefined();
    expect(api.components.schemas.Problem.required).toContain('correlation_id');
  });
});
