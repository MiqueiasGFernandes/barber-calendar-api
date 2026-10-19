\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF (SELECT revision FROM app_meta.schema_build WHERE singleton)<>'002-appointment-scheduling-v1' THEN RAISE EXCEPTION 'upgrade requires scheduling v1'; END IF; END $$;

-- Auditoria administrativa v2.
CREATE TABLE scheduling.configuration_events (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenancy.tenants(id),
  actor_membership_id uuid NOT NULL, operation_id uuid NOT NULL,
  operation text NOT NULL, resource_type text NOT NULL, resource_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL, correlation_id text NOT NULL, changes jsonb NOT NULL,
  FOREIGN KEY (tenant_id,actor_membership_id) REFERENCES tenancy.tenant_memberships(tenant_id,id)
);
CREATE TABLE scheduling.configuration_audit_access (
  principal_name text NOT NULL, tenant_id uuid NOT NULL REFERENCES tenancy.tenants(id),
  granted_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  granted_by text NOT NULL, reason_code text NOT NULL,
  PRIMARY KEY(principal_name,tenant_id),
  CHECK(expires_at>granted_at), CHECK(length(principal_name)>0), CHECK(length(granted_by)>0),
  CHECK(reason_code IN ('support','incident','verification'))
);

-- Auditoria administrativa v2.
ALTER TABLE scheduling.configuration_events
  ADD CONSTRAINT configuration_events_operation CHECK(operation IN ('createService','updateService','createProfessional','updateProfessional','replaceWeeklyWorkPeriods','createAvailabilityException','deleteAvailabilityException','updateTenantTimeZone','updateSchedulingSettings')),
  ADD CONSTRAINT configuration_events_resource CHECK(resource_type IN ('service','professional','weekly_periods','availability_exception','time_zone','tenant_settings')),
  ADD CONSTRAINT configuration_events_changes CHECK(jsonb_typeof(changes)='object' AND changes<>'{}'::jsonb),
  ADD CONSTRAINT configuration_events_correlation CHECK(length(correlation_id) BETWEEN 1 AND 128);
CREATE TRIGGER configuration_events_append_only BEFORE UPDATE OR DELETE ON scheduling.configuration_events FOR EACH ROW EXECUTE FUNCTION scheduling.reject_event_mutation();

-- Auditoria administrativa v2.
CREATE UNIQUE INDEX configuration_events_operation_resource ON scheduling.configuration_events(tenant_id,operation_id,resource_type,resource_id);
CREATE INDEX configuration_events_tenant_time ON scheduling.configuration_events(tenant_id,occurred_at,id);
CREATE INDEX configuration_events_resource_time ON scheduling.configuration_events(tenant_id,resource_type,resource_id,occurred_at,id);
-- A identidade é o login original, nunca uma variável de tenant fornecida pelo consulente.
DO $$ BEGIN CREATE ROLE barber_audit_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE scheduling.configuration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.configuration_audit_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY configuration_access_self ON scheduling.configuration_audit_access FOR SELECT TO barber_audit_reader USING (principal_name=session_user::text);
CREATE POLICY configuration_events_reader ON scheduling.configuration_events FOR SELECT TO barber_audit_reader USING (EXISTS (
 SELECT 1 FROM scheduling.configuration_audit_access a
 WHERE a.principal_name=session_user::text AND a.tenant_id=configuration_events.tenant_id
 AND a.granted_at<=statement_timestamp() AND a.expires_at>statement_timestamp()
));
CREATE POLICY configuration_events_writer ON scheduling.configuration_events FOR INSERT TO barber_runtime WITH CHECK (true);
ALTER TABLE scheduling.configuration_events OWNER TO barber_owner;
ALTER TABLE scheduling.configuration_audit_access OWNER TO barber_owner;

-- Revogações específicas devem seguir os grants genéricos.
REVOKE ALL ON scheduling.configuration_events,scheduling.configuration_audit_access FROM PUBLIC,barber_runtime;
GRANT INSERT ON scheduling.configuration_events TO barber_runtime;
GRANT USAGE ON SCHEMA scheduling TO barber_audit_reader;
GRANT SELECT ON scheduling.configuration_events,scheduling.configuration_audit_access TO barber_audit_reader;
UPDATE app_meta.schema_build SET revision='002-appointment-scheduling-v2' WHERE singleton;
COMMIT;
