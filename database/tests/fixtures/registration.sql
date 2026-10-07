TRUNCATE audit.security_events, identity.email_outbox, identity.authenticated_sessions, identity.otp_challenges,
  identity.registration_attempts, identity.throttle_events, identity.throttle_subjects,
  tenancy.tenant_memberships, identity.user_accounts, tenancy.tenants CASCADE;

