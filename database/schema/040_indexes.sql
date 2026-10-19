CREATE UNIQUE INDEX otp_pending_registration_unique ON identity.otp_challenges(registration_attempt_id) WHERE status='pending' AND purpose='registration';
CREATE UNIQUE INDEX otp_pending_login_unique ON identity.otp_challenges(user_id,tenant_id) WHERE status='pending' AND purpose='login';
CREATE INDEX otp_lookup_idx ON identity.otp_challenges(id,status,expires_at);
CREATE INDEX sessions_authorization_idx ON identity.authenticated_sessions(id,status,expires_at);
CREATE INDEX outbox_dispatch_idx ON identity.email_outbox(status,next_attempt_at,created_at);
CREATE INDEX security_events_correlation_idx ON audit.security_events(correlation_id,occurred_at);
CREATE INDEX throttle_window_idx ON identity.throttle_events(subject_id,action,occurred_at);
CREATE INDEX throttle_retention_idx ON identity.throttle_events(occurred_at);
CREATE INDEX appointments_professional_start_idx ON scheduling.appointments(tenant_id,professional_id,starts_at);
CREATE INDEX appointments_status_start_idx ON scheduling.appointments(tenant_id,status,starts_at);
CREATE INDEX weekly_periods_lookup_idx ON scheduling.weekly_periods(tenant_id,professional_id,iso_weekday);
CREATE INDEX appointment_events_lookup_idx ON scheduling.appointment_events(tenant_id,appointment_id,occurred_at);
CREATE INDEX idempotency_expiry_idx ON scheduling.idempotency_records(expires_at);
CREATE UNIQUE INDEX idempotency_scope_unique ON scheduling.idempotency_records(tenant_id,actor_scope,operation,resource_scope,key_hash);
CREATE INDEX public_throttle_expiry_idx ON scheduling.public_throttle_windows(expires_at);


-- Auditoria administrativa v2.
CREATE UNIQUE INDEX configuration_events_operation_resource ON scheduling.configuration_events(tenant_id,operation_id,resource_type,resource_id);
CREATE INDEX configuration_events_tenant_time ON scheduling.configuration_events(tenant_id,occurred_at,id);
CREATE INDEX configuration_events_resource_time ON scheduling.configuration_events(tenant_id,resource_type,resource_id,occurred_at,id);
