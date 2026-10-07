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

