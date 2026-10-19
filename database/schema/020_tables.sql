CREATE TABLE app_meta.schema_build (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE tenancy.tenants (
  id uuid PRIMARY KEY, name text NOT NULL, slug text NOT NULL, status text NOT NULL DEFAULT 'active',
  time_zone text NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE identity.user_accounts (
  id uuid PRIMARY KEY, email text NOT NULL, normalized_email text NOT NULL, email_verified_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE tenancy.tenant_memberships (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL, status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  CONSTRAINT memberships_tenant_id_unique UNIQUE (tenant_id,id)
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

CREATE TABLE scheduling.tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenancy.tenants(id),
  slot_interval_minutes integer NOT NULL DEFAULT 15 CHECK (slot_interval_minutes > 0),
  minimum_advance_minutes integer NOT NULL DEFAULT 30 CHECK (minimum_advance_minutes >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE scheduling.services (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenancy.tenants(id),
  name text NOT NULL, description text, duration_minutes integer NOT NULL,
  price_minor integer NOT NULL, currency char(3) NOT NULL DEFAULT 'BRL',
  status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id,id)
);
CREATE TABLE scheduling.professionals (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenancy.tenants(id),
  name text NOT NULL, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id,id)
);
CREATE TABLE scheduling.professional_services (
  tenant_id uuid NOT NULL, professional_id uuid NOT NULL, service_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,professional_id,service_id),
  FOREIGN KEY (tenant_id,professional_id) REFERENCES scheduling.professionals(tenant_id,id),
  FOREIGN KEY (tenant_id,service_id) REFERENCES scheduling.services(tenant_id,id)
);
CREATE TABLE scheduling.weekly_periods (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, professional_id uuid NOT NULL,
  iso_weekday smallint NOT NULL, starts_at time NOT NULL, ends_at time NOT NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id,professional_id) REFERENCES scheduling.professionals(tenant_id,id),
  UNIQUE (tenant_id,id)
);
CREATE TABLE scheduling.availability_exceptions (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, professional_id uuid NOT NULL,
  kind text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  reason text, created_by_membership_id uuid NOT NULL, created_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id,professional_id) REFERENCES scheduling.professionals(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by_membership_id) REFERENCES tenancy.tenant_memberships(tenant_id,id),
  UNIQUE (tenant_id,id)
);
CREATE TABLE scheduling.appointments (
  id uuid PRIMARY KEY, public_id uuid NOT NULL UNIQUE, tenant_id uuid NOT NULL,
  professional_id uuid NOT NULL, service_id uuid NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'confirmed',
  customer_name text NOT NULL, customer_phone text NOT NULL, customer_email text NOT NULL,
  service_name_snapshot text NOT NULL, duration_minutes_snapshot integer NOT NULL,
  price_minor_snapshot integer NOT NULL, currency_snapshot char(3) NOT NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,professional_id) REFERENCES scheduling.professionals(tenant_id,id),
  FOREIGN KEY (tenant_id,service_id) REFERENCES scheduling.services(tenant_id,id)
);
CREATE TABLE scheduling.appointment_events (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, appointment_id uuid NOT NULL,
  event_type text NOT NULL, actor_membership_id uuid, occurred_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL, previous_status text, new_status text NOT NULL,
  previous_starts_at timestamptz, previous_ends_at timestamptz,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id,appointment_id) REFERENCES scheduling.appointments(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_membership_id) REFERENCES tenancy.tenant_memberships(tenant_id,id)
);
CREATE TABLE scheduling.idempotency_records (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, actor_scope text NOT NULL,
  operation text NOT NULL, resource_scope text NOT NULL, key_hash bytea NOT NULL,
  request_hash bytea NOT NULL, appointment_id uuid, response_status integer NOT NULL,
  response_headers jsonb NOT NULL DEFAULT '{}', response_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id,appointment_id) REFERENCES scheduling.appointments(tenant_id,id)
);
CREATE TABLE scheduling.public_throttle_windows (
  tenant_id uuid NOT NULL, ip_hash bytea NOT NULL, operation_group text NOT NULL,
  window_start timestamptz NOT NULL, request_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,ip_hash,operation_group,window_start)
);


-- Auditoria administrativa v2.
CREATE TABLE scheduling.configuration_events (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenancy.tenants(id),
  actor_membership_id uuid NOT NULL, operation_id uuid NOT NULL,
  operation text NOT NULL, resource_type text NOT NULL, resource_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL, correlation_id text NOT NULL, changes jsonb NOT NULL,
  FOREIGN KEY (tenant_id,actor_membership_id) REFERENCES tenancy.tenant_memberships(tenant_id,id)
);
CREATE TABLE scheduling.configuration_audit_access (
  principal_name text NOT NULL, tenant_id uuid NOT NULL REFERENCES tenancy.tenants(id),
  granted_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  granted_by text NOT NULL, reason_code text NOT NULL,
  PRIMARY KEY(principal_name,tenant_id),
  CHECK(expires_at>granted_at), CHECK(length(principal_name)>0), CHECK(length(granted_by)>0),
  CHECK(reason_code IN ('support','incident','verification'))
);
