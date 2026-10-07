ALTER SCHEMA app_meta OWNER TO barber_owner;
ALTER SCHEMA identity OWNER TO barber_owner;
ALTER SCHEMA tenancy OWNER TO barber_owner;
ALTER SCHEMA audit OWNER TO barber_owner;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('app_meta','identity','tenancy','audit') LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO barber_owner',item.schemaname,item.tablename);
  END LOOP;
END $$;
REVOKE ALL ON DATABASE barber_calendar_e2e FROM barber_runtime;
GRANT CONNECT ON DATABASE barber_calendar_e2e TO barber_runtime;
GRANT USAGE ON SCHEMA app_meta, identity, tenancy, audit TO barber_runtime;
GRANT SELECT ON app_meta.schema_build TO barber_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA identity,tenancy,audit TO barber_runtime;
REVOKE CREATE ON SCHEMA public, app_meta, identity, tenancy, audit FROM barber_runtime;
