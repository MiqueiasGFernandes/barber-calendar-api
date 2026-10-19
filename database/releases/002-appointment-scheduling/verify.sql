\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM app_meta.schema_build WHERE singleton AND revision='002-appointment-scheduling-v1') THEN RAISE EXCEPTION 'schema revision mismatch'; END IF;
  IF to_regclass('scheduling.appointments') IS NULL OR to_regclass('scheduling.tenant_settings') IS NULL THEN RAISE EXCEPTION 'scheduling relations missing'; END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname='tenants_time_zone_check') OR NOT EXISTS (SELECT FROM pg_constraint WHERE conname='memberships_tenant_id_unique') THEN RAISE EXCEPTION 'tenant scope constraints missing'; END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname='appointments_confirmed_no_overlap') THEN RAISE EXCEPTION 'appointment overlap constraint missing'; END IF;
  IF has_table_privilege('barber_runtime','scheduling.appointment_events','UPDATE') OR has_table_privilege('barber_runtime','scheduling.appointment_events','DELETE') THEN RAISE EXCEPTION 'runtime can mutate appointment events'; END IF;
END $$;
