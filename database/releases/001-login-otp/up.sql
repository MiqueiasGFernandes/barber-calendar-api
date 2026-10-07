\set ON_ERROR_STOP on
BEGIN;
CREATE INDEX IF NOT EXISTS sessions_authorization_idx ON identity.authenticated_sessions(id,status,expires_at);
UPDATE app_meta.schema_build SET revision='001-tenant-authentication-v3', applied_at=clock_timestamp() WHERE singleton;
COMMIT;

