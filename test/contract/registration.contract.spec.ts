import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { Ajv } from 'ajv';
const api = YAML.parse(
  readFileSync('specs/001-tenant-authentication/contracts/openapi.yaml', 'utf8'),
) as Record<string, any>;
describe('registration OpenAPI contract', () => {
  it('valida requests e responses pelas definições JSON Schema do OpenAPI 3.1', () => {
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
    ajv.addSchema(api, 'https://barber-calendar.test/openapi.yaml');
    const schema = (name: string) =>
      ajv.compile({
        $ref: `https://barber-calendar.test/openapi.yaml#/components/schemas/${name}`,
      });
    expect(
      schema('TenantRegistrationRequest')({
        tenant_name: 'Loja',
        tenant_slug: 'loja-test',
        administrator_email: 'owner@example.test',
      }),
    ).toBe(true);
    expect(
      schema('TenantRegistrationRequest')({
        tenant_name: 'Loja',
        tenant_slug: 'loja-test',
        administrator_email: 'owner@example.test',
        password: 'not-allowed',
      }),
    ).toBe(false);
    expect(
      schema('RegistrationAttemptResponse')({
        registration_attempt_id: '10000000-0000-4000-8000-000000000001',
        status: 'verification_required',
        challenge_id: '10000000-0000-4000-8000-000000000002',
        expires_in: 600,
        resend_after: 60,
      }),
    ).toBe(true);
  });
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
