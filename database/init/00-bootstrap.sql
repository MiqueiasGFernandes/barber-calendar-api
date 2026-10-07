\set ON_ERROR_STOP on
\if :{?BARBER_DATABASE}
\else
  \set BARBER_DATABASE barber_calendar_e2e
\endif
SELECT format('CREATE DATABASE %I', :'BARBER_DATABASE')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'BARBER_DATABASE') \gexec
\connect :BARBER_DATABASE
BEGIN;
\ir /opt/app-sql/schema/001_extensions.sql
\ir /opt/app-sql/schema/010_schemas.sql
\ir /opt/app-sql/schema/020_tables.sql
\ir /opt/app-sql/schema/030_constraints.sql
\ir /opt/app-sql/schema/040_indexes.sql
\ir /opt/app-sql/schema/090_schema_manifest.sql
\ir /opt/app-sql/schema/090_grants.sql
COMMIT;

