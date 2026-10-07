CREATE TABLE app_meta.schema_build (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE tenancy.tenants (
  id uuid PRIMARY KEY, name text NOT NULL, slug text NOT NULL, status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE identity.user_accounts (
  id uuid PRIMARY KEY, email text NOT NULL, normalized_email text NOT NULL, email_verified_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE tenancy.tenant_memberships (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL, status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE identity.registration_attempts (
  id uuid PRIMARY KEY, tenant_name text NOT NULL, tenant_slug text NOT NULL, administrator_email text NOT NULL,
  normalized_email text NOT NULL, status text NOT NULL DEFAULT 'pending', expires_at timestamptz NOT NULL,
  completed_at timestamptz, tenant_id uuid, user_id uuid, membership_id uuid, created_at timestamptz NOT NULL
);
CREATE TABLE identity.otp_challenges (
  id uuid PRIMARY KEY, purpose text NOT NULL, registration_attempt_id uuid, user_id uuid, tenant_id uuid,
  membership_id uuid, normalized_email text NOT NULL, origin_digest bytea NOT NULL, status text NOT NULL DEFAULT 'pending',
  code_digest bytea NOT NULL, key_version smallint NOT NULL, issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  failed_attempts smallint NOT NULL DEFAULT 0, consumed_at timestamptz, superseded_at timestamptz, locked_at timestamptz
);
CREATE TABLE identity.authenticated_sessions (
  id uuid PRIMARY KEY, jti uuid NOT NULL, user_id uuid NOT NULL, tenant_id uuid NOT NULL, membership_id uuid NOT NULL,
  role text NOT NULL, issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'active',
  revoked_at timestamptz, created_at timestamptz NOT NULL
);
CREATE TABLE identity.email_outbox (
  id uuid PRIMARY KEY, challenge_id uuid NOT NULL, kind text NOT NULL, provider text NOT NULL,
  envelope_ciphertext bytea, encryption_key_version smallint NOT NULL, status text NOT NULL DEFAULT 'pending',
  provider_message_id text, created_at timestamptz NOT NULL, leased_until timestamptz, delivered_at timestamptz,
  failed_at timestamptz, attempt_count integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL,
  payload_purged_at timestamptz
);
CREATE TABLE audit.security_events (
  id uuid PRIMARY KEY, event_type text NOT NULL, outcome text NOT NULL, occurred_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL, tenant_id uuid, actor_user_id uuid, challenge_id uuid, session_id uuid,
  reason_code text, metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE identity.throttle_subjects (
  id uuid PRIMARY KEY, scope_type text NOT NULL, scope_digest bytea NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE identity.throttle_events (
  id uuid PRIMARY KEY, subject_id uuid NOT NULL, action text NOT NULL, occurred_at timestamptz NOT NULL
);

