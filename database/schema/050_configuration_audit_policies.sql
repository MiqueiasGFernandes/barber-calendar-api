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
