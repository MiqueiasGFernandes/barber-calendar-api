\set ON_ERROR_STOP on
BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA scheduling;
CREATE TABLE scheduling.tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenancy.tenants(id),
  slot_interval_minutes integer NOT NULL DEFAULT 15 CHECK (slot_interval_minutes > 0),
  minimum_advance_minutes integer NOT NULL DEFAULT 30 CHECK (minimum_advance_minutes >= 0),
  time_zone text NOT NULL DEFAULT 'America/Sao_Paulo',
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
ALTER TABLE scheduling.tenant_settings ADD CONSTRAINT tenant_settings_time_zone_check CHECK (length(time_zone) BETWEEN 1 AND 64);
ALTER TABLE scheduling.services
  ADD CONSTRAINT services_name_check CHECK (name=btrim(name) AND length(name) BETWEEN 1 AND 120),
  ADD CONSTRAINT services_description_check CHECK (description IS NULL OR length(description)<=1000),
  ADD CONSTRAINT services_duration_check CHECK (duration_minutes BETWEEN 1 AND 480),
  ADD CONSTRAINT services_price_check CHECK (price_minor>=0),
  ADD CONSTRAINT services_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT services_status_check CHECK (status IN ('active','inactive'));
ALTER TABLE scheduling.professionals
  ADD CONSTRAINT professionals_name_check CHECK (name=btrim(name) AND length(name) BETWEEN 1 AND 120),
  ADD CONSTRAINT professionals_status_check CHECK (status IN ('active','inactive'));
ALTER TABLE scheduling.weekly_periods
  ADD CONSTRAINT weekly_periods_day_check CHECK (iso_weekday BETWEEN 1 AND 7),
  ADD CONSTRAINT weekly_periods_time_check CHECK (starts_at<ends_at),
  ADD CONSTRAINT weekly_periods_no_overlap EXCLUDE USING gist (tenant_id WITH =, professional_id WITH =, iso_weekday WITH =, tsrange(date '2000-01-03'+starts_at, date '2000-01-03'+ends_at,'[)') WITH &&);
ALTER TABLE scheduling.availability_exceptions
  ADD CONSTRAINT exceptions_kind_check CHECK (kind IN ('break','time_off','holiday','blocked')),
  ADD CONSTRAINT exceptions_time_check CHECK (ends_at>starts_at),
  ADD CONSTRAINT exceptions_reason_check CHECK (reason IS NULL OR length(reason)<=240);
ALTER TABLE scheduling.appointments
  ADD CONSTRAINT appointments_time_check CHECK (ends_at>starts_at),
  ADD CONSTRAINT appointments_status_check CHECK (status IN ('confirmed','cancelled','attended','no_show')),
  ADD CONSTRAINT appointments_customer_name_check CHECK (customer_name=btrim(customer_name) AND length(customer_name) BETWEEN 1 AND 160),
  ADD CONSTRAINT appointments_phone_check CHECK (customer_phone ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT appointments_email_check CHECK (customer_email=btrim(customer_email) AND length(customer_email)<=254 AND position('@' in customer_email)>1),
  ADD CONSTRAINT appointments_snapshot_check CHECK (duration_minutes_snapshot BETWEEN 1 AND 480 AND price_minor_snapshot>=0);
ALTER TABLE scheduling.appointment_events
  ADD CONSTRAINT appointment_events_type_check CHECK (event_type IN ('created','rescheduled','cancelled','attended','no_show')),
  ADD CONSTRAINT appointment_events_status_check CHECK (new_status IN ('confirmed','cancelled','attended','no_show') AND (previous_status IS NULL OR previous_status IN ('confirmed','cancelled','attended','no_show'))),
  ADD CONSTRAINT appointment_events_actor_check CHECK (event_type='created' OR actor_membership_id IS NOT NULL);
ALTER TABLE scheduling.idempotency_records
  ADD CONSTRAINT idempotency_hash_lengths_check CHECK (octet_length(key_hash)=32 AND octet_length(request_hash)=32),
  ADD CONSTRAINT idempotency_expiry_check CHECK (expires_at=created_at+interval '24 hours'),
  ADD CONSTRAINT idempotency_response_check CHECK (response_status BETWEEN 200 AND 599 AND jsonb_typeof(response_headers)='object');
ALTER TABLE scheduling.public_throttle_windows
  ADD CONSTRAINT public_throttle_ip_hash_check CHECK (octet_length(ip_hash)=32),
  ADD CONSTRAINT public_throttle_group_check CHECK (operation_group IN ('read','booking')),
  ADD CONSTRAINT public_throttle_count_check CHECK (request_count>=0 AND expires_at>window_start);
ALTER TABLE scheduling.appointments ADD CONSTRAINT appointments_confirmed_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, professional_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (status='confirmed');
CREATE FUNCTION scheduling.reject_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'appointment events are append-only'; END $$;
CREATE TRIGGER appointment_events_append_only BEFORE UPDATE OR DELETE ON scheduling.appointment_events FOR EACH ROW EXECUTE FUNCTION scheduling.reject_event_mutation();
CREATE INDEX appointments_professional_start_idx ON scheduling.appointments(tenant_id,professional_id,starts_at);
CREATE INDEX appointments_status_start_idx ON scheduling.appointments(tenant_id,status,starts_at);
CREATE INDEX weekly_periods_lookup_idx ON scheduling.weekly_periods(tenant_id,professional_id,iso_weekday);
CREATE INDEX appointment_events_lookup_idx ON scheduling.appointment_events(tenant_id,appointment_id,occurred_at);
CREATE INDEX idempotency_expiry_idx ON scheduling.idempotency_records(expires_at);
CREATE UNIQUE INDEX idempotency_scope_unique ON scheduling.idempotency_records(tenant_id,actor_scope,operation,resource_scope,key_hash);
CREATE INDEX public_throttle_expiry_idx ON scheduling.public_throttle_windows(expires_at);
ALTER SCHEMA scheduling OWNER TO barber_owner;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='scheduling' LOOP
    EXECUTE format('ALTER TABLE scheduling.%I OWNER TO barber_owner',item.tablename);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA scheduling TO barber_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA scheduling TO barber_runtime;
REVOKE UPDATE,DELETE ON scheduling.appointment_events FROM barber_runtime;
REVOKE CREATE ON SCHEMA scheduling FROM barber_runtime;
INSERT INTO scheduling.tenant_settings(tenant_id) SELECT id FROM tenancy.tenants ON CONFLICT DO NOTHING;
UPDATE app_meta.schema_build SET revision='002-appointment-scheduling-v1', applied_at=clock_timestamp() WHERE singleton;
COMMIT;
