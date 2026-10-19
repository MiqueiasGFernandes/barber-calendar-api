INSERT INTO scheduling.tenant_settings(tenant_id) SELECT id FROM tenancy.tenants ON CONFLICT DO NOTHING;
INSERT INTO app_meta.schema_build(singleton,revision) VALUES (true,'002-appointment-scheduling-v2');

