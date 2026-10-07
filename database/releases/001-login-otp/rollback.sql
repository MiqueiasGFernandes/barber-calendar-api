\set ON_ERROR_STOP on
BEGIN;
DROP INDEX IF EXISTS identity.sessions_authorization_idx;
UPDATE app_meta.schema_build SET revision='001-tenant-authentication-v2', applied_at=clock_timestamp() WHERE singleton;
COMMIT;

