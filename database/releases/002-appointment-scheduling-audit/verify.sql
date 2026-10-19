\set ON_ERROR_STOP on
DO $$ BEGIN
 IF (SELECT revision FROM app_meta.schema_build WHERE singleton)<>'002-appointment-scheduling-v2' THEN RAISE EXCEPTION 'expected scheduling v2'; END IF;
 IF NOT EXISTS(SELECT FROM pg_policies WHERE schemaname='scheduling' AND tablename='configuration_events' AND policyname='configuration_events_reader') THEN RAISE EXCEPTION 'audit RLS missing'; END IF;
 IF has_table_privilege('barber_runtime','scheduling.configuration_events','SELECT') OR has_table_privilege('barber_runtime','scheduling.configuration_events','UPDATE,DELETE,TRUNCATE') OR NOT has_table_privilege('barber_runtime','scheduling.configuration_events','INSERT') THEN RAISE EXCEPTION 'audit runtime grants invalid'; END IF;
 IF has_table_privilege('barber_runtime','scheduling.configuration_audit_access','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN RAISE EXCEPTION 'audit ACL exposed'; END IF;
 IF NOT EXISTS(SELECT FROM pg_class WHERE oid='scheduling.configuration_events'::regclass AND relrowsecurity) OR NOT EXISTS(SELECT FROM pg_class WHERE oid='scheduling.configuration_audit_access'::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'audit RLS disabled'; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='barber_audit_reader' AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolbypassrls)) THEN RAISE EXCEPTION 'unsafe audit reader'; END IF;
END $$;
