\set ON_ERROR_STOP on
BEGIN;
DROP SCHEMA scheduling CASCADE;
UPDATE app_meta.schema_build SET revision='001-tenant-authentication-v3', applied_at=clock_timestamp() WHERE singleton;
COMMIT;
