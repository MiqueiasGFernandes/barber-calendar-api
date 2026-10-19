\set ON_ERROR_STOP on
BEGIN;
DROP SCHEMA scheduling CASCADE;
ALTER TABLE tenancy.tenants DROP CONSTRAINT tenants_time_zone_check;
ALTER TABLE tenancy.tenants DROP COLUMN time_zone;
ALTER TABLE tenancy.tenant_memberships DROP CONSTRAINT IF EXISTS memberships_tenant_id_unique;
UPDATE app_meta.schema_build SET revision='001-tenant-authentication-v3', applied_at=clock_timestamp() WHERE singleton;
COMMIT;
