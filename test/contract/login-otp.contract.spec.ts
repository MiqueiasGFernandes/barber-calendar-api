import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
const api = YAML.parse(
  readFileSync('specs/001-tenant-authentication/contracts/openapi.yaml', 'utf8'),
) as Record<string, any>;
describe('login OTP OpenAPI contract', () => {
  it('keeps the accepted response anti-enumeration shape', () => {
    const operation = api.paths['/auth/otp-requests'].post;
    expect(operation.responses['202']).toBeDefined();
    expect(operation.responses['429'].$ref).toBe('#/components/responses/TooManyRequests');
    expect(api.components.responses.TooManyRequests.headers['Retry-After']).toBeDefined();
    const response = api.components.schemas.OtpRequestResponse;
    expect(response.required).toEqual(['status', 'challenge_id', 'expires_in', 'resend_after']);
  });
  it('bounds session lifetime', () => {
    const expires = api.components.schemas.TokenResponse.properties.expires_in;
    expect(expires.minimum).toBe(900);
    expect(expires.maximum).toBe(604800);
    expect(expires.default).toBe(86400);
  });
});
