\set ON_ERROR_STOP on
-- DESTRUTIVO: exportar a auditoria protegida antes de remover o incremento.
BEGIN;
DO $$ BEGIN IF (SELECT revision FROM app_meta.schema_build WHERE singleton)<>'002-appointment-scheduling-v2' THEN RAISE EXCEPTION 'rollback requires scheduling v2'; END IF; END $$;
DROP TABLE scheduling.configuration_events;
DROP TABLE scheduling.configuration_audit_access;
REVOKE USAGE ON SCHEMA scheduling FROM barber_audit_reader;
UPDATE app_meta.schema_build SET revision='002-appointment-scheduling-v1' WHERE singleton;
COMMIT;
-- O papel coletivo permanece sem acesso à trilha removida; logins são geridos pela operação.
