\set ON_ERROR_STOP on
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(expected,'.') INTO missing FROM (VALUES
    ('app_meta.schema_build'),('tenancy.tenants'),('identity.user_accounts'),('tenancy.tenant_memberships'),
    ('identity.registration_attempts'),('identity.otp_challenges'),('identity.authenticated_sessions'),
    ('identity.email_outbox'),('audit.security_events'),('identity.throttle_subjects'),('identity.throttle_events')
  ) AS x(expected) WHERE to_regclass(expected) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'missing relations: %', missing; END IF;
  SELECT string_agg(expected,', ') INTO missing FROM (VALUES
    ('tenants_slug_unique'),('users_email_unique'),('memberships_pair_unique'),
    ('challenges_digest_check'),('challenges_scope_check'),('sessions_jti_unique'),
    ('sessions_time_check'),('outbox_payload_check'),('throttle_scope_unique'),
    ('throttle_digest_check')
  ) AS x(expected)
  WHERE NOT EXISTS (SELECT FROM pg_constraint WHERE conname=expected);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'missing constraints: %', missing; END IF;
  SELECT string_agg(expected,', ') INTO missing FROM (VALUES
    ('identity.otp_pending_registration_unique'),('identity.otp_pending_login_unique'),
    ('identity.sessions_authorization_idx'),('identity.outbox_dispatch_idx'),
    ('identity.throttle_window_idx'),('identity.throttle_retention_idx')
  ) AS x(expected) WHERE to_regclass(expected) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'missing indexes: %', missing; END IF;
  IF NOT EXISTS (SELECT FROM app_meta.schema_build WHERE singleton AND revision='001-tenant-authentication-v3') THEN RAISE EXCEPTION 'schema revision mismatch'; END IF;
  IF has_schema_privilege('barber_runtime','identity','CREATE') THEN RAISE EXCEPTION 'runtime can create in identity'; END IF;
  IF has_database_privilege('barber_runtime',current_database(),'CREATE') THEN RAISE EXCEPTION 'runtime can create database objects'; END IF;
END $$;
