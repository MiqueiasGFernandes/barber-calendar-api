export interface TenantRegistrationRequest {
  tenant_name: string;
  tenant_slug: string;
  administrator_email: string;
}
export interface RegistrationAttemptResponse {
  registration_attempt_id: string;
  status: 'verification_required';
  challenge_id: string;
  expires_in: 600;
  resend_after: 60;
}
export interface OtpRequest {
  tenant_slug: string;
  email: string;
}
export interface OtpRequestResponse {
  status: 'accepted';
  challenge_id: string;
  expires_in: 600;
  resend_after: 60;
}
export interface OtpVerificationRequest {
  challenge_id: string;
  code: string;
}
export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  correlation_id: string;
  detail?: string;
  retry_after_seconds?: number;
}
