CREATE UNIQUE INDEX otp_pending_registration_unique ON identity.otp_challenges(registration_attempt_id) WHERE status='pending' AND purpose='registration';
CREATE UNIQUE INDEX otp_pending_login_unique ON identity.otp_challenges(user_id,tenant_id) WHERE status='pending' AND purpose='login';
CREATE INDEX otp_lookup_idx ON identity.otp_challenges(id,status,expires_at);
CREATE INDEX sessions_authorization_idx ON identity.authenticated_sessions(id,status,expires_at);
CREATE INDEX outbox_dispatch_idx ON identity.email_outbox(status,next_attempt_at,created_at);
CREATE INDEX security_events_correlation_idx ON audit.security_events(correlation_id,occurred_at);
CREATE INDEX throttle_window_idx ON identity.throttle_events(subject_id,action,occurred_at);
CREATE INDEX throttle_retention_idx ON identity.throttle_events(occurred_at);

