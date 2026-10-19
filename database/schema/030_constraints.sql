ALTER TABLE tenancy.tenants
  ADD CONSTRAINT tenants_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 160 AND name = btrim(name)),
  ADD CONSTRAINT tenants_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 80),
  ADD CONSTRAINT tenants_status_check CHECK (status IN ('active','suspended')),
  ADD CONSTRAINT tenants_slug_unique UNIQUE (slug);
ALTER TABLE identity.user_accounts
  ADD CONSTRAINT users_email_check CHECK (email = btrim(email) AND length(email) <= 254),
  ADD CONSTRAINT users_normalized_email_check CHECK (normalized_email = lower(btrim(normalized_email))),
  ADD CONSTRAINT users_status_check CHECK (status IN ('active','suspended')),
  ADD CONSTRAINT users_email_unique UNIQUE (normalized_email);
ALTER TABLE tenancy.tenant_memberships
  ADD CONSTRAINT memberships_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id),
  ADD CONSTRAINT memberships_user_fk FOREIGN KEY (user_id) REFERENCES identity.user_accounts(id),
  ADD CONSTRAINT memberships_role_check CHECK (role IN ('administrator','member')),
  ADD CONSTRAINT memberships_status_check CHECK (status IN ('active','inactive')),
  ADD CONSTRAINT memberships_pair_unique UNIQUE (tenant_id,user_id);
ALTER TABLE identity.registration_attempts
  ADD CONSTRAINT attempts_status_check CHECK (status IN ('pending','completed','expired')),
  ADD CONSTRAINT attempts_name_check CHECK (length(btrim(tenant_name)) BETWEEN 1 AND 160 AND tenant_name = btrim(tenant_name)),
  ADD CONSTRAINT attempts_slug_check CHECK (tenant_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(tenant_slug) BETWEEN 3 AND 80),
  ADD CONSTRAINT attempts_completion_check CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  ADD CONSTRAINT attempts_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id),
  ADD CONSTRAINT attempts_user_fk FOREIGN KEY (user_id) REFERENCES identity.user_accounts(id),
  ADD CONSTRAINT attempts_membership_fk FOREIGN KEY (membership_id) REFERENCES tenancy.tenant_memberships(id);
ALTER TABLE identity.otp_challenges
  ADD CONSTRAINT challenges_purpose_check CHECK (purpose IN ('registration','login')),
  ADD CONSTRAINT challenges_status_check CHECK (status IN ('pending','consumed','superseded','locked','expired')),
  ADD CONSTRAINT challenges_digest_check CHECK (octet_length(code_digest)=32),
  ADD CONSTRAINT challenges_origin_check CHECK (octet_length(origin_digest)=32),
  ADD CONSTRAINT challenges_failures_check CHECK (failed_attempts BETWEEN 0 AND 5),
  ADD CONSTRAINT challenges_time_check CHECK (expires_at = issued_at + interval '10 minutes'),
  ADD CONSTRAINT challenges_scope_check CHECK (
    (purpose='registration' AND registration_attempt_id IS NOT NULL AND user_id IS NULL AND tenant_id IS NULL AND membership_id IS NULL)
    OR (purpose='login' AND registration_attempt_id IS NULL AND user_id IS NOT NULL AND tenant_id IS NOT NULL AND membership_id IS NOT NULL)),
  ADD CONSTRAINT challenges_attempt_fk FOREIGN KEY (registration_attempt_id) REFERENCES identity.registration_attempts(id),
  ADD CONSTRAINT challenges_user_fk FOREIGN KEY (user_id) REFERENCES identity.user_accounts(id),
  ADD CONSTRAINT challenges_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id),
  ADD CONSTRAINT challenges_membership_fk FOREIGN KEY (membership_id) REFERENCES tenancy.tenant_memberships(id);
ALTER TABLE identity.authenticated_sessions
  ADD CONSTRAINT sessions_jti_unique UNIQUE (jti),
  ADD CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES identity.user_accounts(id),
  ADD CONSTRAINT sessions_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id),
  ADD CONSTRAINT sessions_membership_fk FOREIGN KEY (membership_id) REFERENCES tenancy.tenant_memberships(id),
  ADD CONSTRAINT sessions_role_check CHECK (role IN ('administrator','member')),
  ADD CONSTRAINT sessions_status_check CHECK (status IN ('active','expired','revoked')),
  ADD CONSTRAINT sessions_time_check CHECK (expires_at > issued_at);
ALTER TABLE identity.email_outbox
  ADD CONSTRAINT outbox_challenge_fk FOREIGN KEY (challenge_id) REFERENCES identity.otp_challenges(id),
  ADD CONSTRAINT outbox_challenge_unique UNIQUE (challenge_id),
  ADD CONSTRAINT outbox_kind_check CHECK (kind IN ('registration_otp','login_otp')),
  ADD CONSTRAINT outbox_status_check CHECK (status IN ('pending','leased','delivered','retryable','failed','expired')),
  ADD CONSTRAINT outbox_attempt_check CHECK (attempt_count >= 0),
  ADD CONSTRAINT outbox_payload_check CHECK ((status IN ('delivered','failed','expired')) = (envelope_ciphertext IS NULL AND payload_purged_at IS NOT NULL));
ALTER TABLE audit.security_events
  ADD CONSTRAINT events_outcome_check CHECK (outcome IN ('succeeded','rejected','failed')),
  ADD CONSTRAINT events_metadata_object CHECK (jsonb_typeof(metadata)='object');
ALTER TABLE identity.throttle_subjects
  ADD CONSTRAINT throttle_scope_check CHECK (scope_type IN ('tenant_email','ip')),
  ADD CONSTRAINT throttle_digest_check CHECK (octet_length(scope_digest)=32),
  ADD CONSTRAINT throttle_scope_unique UNIQUE (scope_type,scope_digest);
ALTER TABLE identity.throttle_events
  ADD CONSTRAINT throttle_subject_fk FOREIGN KEY (subject_id) REFERENCES identity.throttle_subjects(id) ON DELETE CASCADE,
  ADD CONSTRAINT throttle_action_check CHECK (action IN ('registration','otp_issue','otp_verify_failure'));

ALTER TABLE tenancy.tenants ADD CONSTRAINT tenants_time_zone_check CHECK (length(time_zone) BETWEEN 1 AND 64);
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
  ADD CONSTRAINT appointments_email_check CHECK (customer_email=lower(btrim(customer_email)) AND length(customer_email)<=254 AND customer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  ADD CONSTRAINT appointments_snapshot_check CHECK (length(service_name_snapshot) BETWEEN 1 AND 120 AND duration_minutes_snapshot BETWEEN 1 AND 480 AND price_minor_snapshot>=0),
  ADD CONSTRAINT appointments_professional_service_fk FOREIGN KEY (tenant_id,professional_id,service_id) REFERENCES scheduling.professional_services(tenant_id,professional_id,service_id);
ALTER TABLE scheduling.appointment_events
  ADD CONSTRAINT appointment_events_type_check CHECK (event_type IN ('created','rescheduled','cancelled','attended','no_show')),
  ADD CONSTRAINT appointment_events_status_check CHECK (new_status IN ('confirmed','cancelled','attended','no_show') AND (previous_status IS NULL OR previous_status IN ('confirmed','cancelled','attended','no_show'))),
  ADD CONSTRAINT appointment_events_actor_check CHECK (event_type='created' OR actor_membership_id IS NOT NULL),
  ADD CONSTRAINT appointment_events_interval_check CHECK (ends_at>starts_at AND (previous_starts_at IS NULL OR previous_ends_at>previous_starts_at)),
  ADD CONSTRAINT appointment_events_transition_check CHECK ((event_type='created' AND previous_status IS NULL AND new_status='confirmed') OR (event_type='rescheduled' AND previous_status='confirmed' AND new_status='confirmed') OR (event_type='cancelled' AND previous_status='confirmed' AND new_status='cancelled') OR (event_type='attended' AND previous_status='confirmed' AND new_status='attended') OR (event_type='no_show' AND previous_status='confirmed' AND new_status='no_show'));
ALTER TABLE scheduling.idempotency_records
  ADD CONSTRAINT idempotency_hash_lengths_check CHECK (octet_length(key_hash)=32 AND octet_length(request_hash)=32),
  ADD CONSTRAINT idempotency_expiry_check CHECK (expires_at=created_at+interval '24 hours'),
  ADD CONSTRAINT idempotency_response_check CHECK (response_status BETWEEN 200 AND 599 AND jsonb_typeof(response_headers)='object'),
  ADD CONSTRAINT idempotency_actor_scope_check CHECK (actor_scope='public' OR actor_scope ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  ADD CONSTRAINT idempotency_operation_scope_check CHECK (length(operation) BETWEEN 1 AND 120 AND length(resource_scope) BETWEEN 1 AND 160);
ALTER TABLE scheduling.public_throttle_windows
  ADD CONSTRAINT public_throttle_ip_hash_check CHECK (octet_length(ip_hash)=32),
  ADD CONSTRAINT public_throttle_group_check CHECK (operation_group IN ('read','booking')),
  ADD CONSTRAINT public_throttle_count_check CHECK (request_count>=0 AND expires_at>window_start);
ALTER TABLE scheduling.appointments ADD CONSTRAINT appointments_confirmed_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, professional_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (status='confirmed');
CREATE FUNCTION scheduling.reject_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'appointment events are append-only'; END $$;
CREATE TRIGGER appointment_events_append_only BEFORE UPDATE OR DELETE ON scheduling.appointment_events FOR EACH ROW EXECUTE FUNCTION scheduling.reject_event_mutation();


-- Auditoria administrativa v2.
ALTER TABLE scheduling.configuration_events
  ADD CONSTRAINT configuration_events_operation CHECK(operation IN ('createService','updateService','createProfessional','updateProfessional','replaceWeeklyWorkPeriods','createAvailabilityException','deleteAvailabilityException','updateTenantTimeZone','updateSchedulingSettings')),
  ADD CONSTRAINT configuration_events_resource CHECK(resource_type IN ('service','professional','weekly_periods','availability_exception','time_zone','tenant_settings')),
  ADD CONSTRAINT configuration_events_changes CHECK(jsonb_typeof(changes)='object' AND changes<>'{}'::jsonb),
  ADD CONSTRAINT configuration_events_correlation CHECK(length(correlation_id) BETWEEN 1 AND 128);
CREATE TRIGGER configuration_events_append_only BEFORE UPDATE OR DELETE ON scheduling.configuration_events FOR EACH ROW EXECUTE FUNCTION scheduling.reject_event_mutation();
