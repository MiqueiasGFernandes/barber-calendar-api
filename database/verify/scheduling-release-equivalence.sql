-- Compara semântica, sem depender da posição física das colunas, OIDs ou instante de aplicação.
-- btree_gist pode permanecer instalado após rollback; sua presença é validada pelo verify.sql do release.
WITH scopes(name) AS (VALUES ('app_meta'),('identity'),('tenancy'),('audit'),('scheduling'))
SELECT jsonb_build_object(
  'columns',(SELECT jsonb_agg(jsonb_build_array(table_schema,table_name,column_name,udt_schema,udt_name,is_nullable,column_default,character_maximum_length,numeric_precision,numeric_scale) ORDER BY table_schema,table_name,column_name) FROM information_schema.columns WHERE table_schema IN (SELECT name FROM scopes)),
  'constraints',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid)) ORDER BY n.nspname,c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN (SELECT name FROM scopes)),
  'indexes',(SELECT jsonb_agg(jsonb_build_array(schemaname,tablename,indexname,indexdef) ORDER BY schemaname,tablename,indexname) FROM pg_indexes WHERE schemaname IN (SELECT name FROM scopes)),
  'table_grants',(SELECT jsonb_agg(jsonb_build_array(table_schema,table_name,grantor,grantee,privilege_type,is_grantable) ORDER BY table_schema,table_name,grantor,grantee,privilege_type) FROM information_schema.role_table_grants WHERE table_schema IN (SELECT name FROM scopes)),
  'schema_grants',(SELECT jsonb_agg(jsonb_build_array(n.nspname,pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable) ORDER BY n.nspname,a.grantor,a.grantee,a.privilege_type) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE n.nspname IN (SELECT name FROM scopes)),
  'schema_owners',(SELECT jsonb_agg(jsonb_build_array(nspname,pg_get_userbyid(nspowner)) ORDER BY nspname) FROM pg_namespace WHERE nspname IN (SELECT name FROM scopes)),
  'table_owners',(SELECT jsonb_agg(jsonb_build_array(schemaname,tablename,tableowner) ORDER BY schemaname,tablename) FROM pg_tables WHERE schemaname IN (SELECT name FROM scopes)),
  'functions',(SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.prosecdef) ORDER BY n.nspname,p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN (SELECT name FROM scopes)),
  'triggers',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid)) ORDER BY n.nspname,c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN (SELECT name FROM scopes)),
  'rls',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN (SELECT name FROM scopes)),
  'policies',(SELECT jsonb_agg(jsonb_build_array(schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check) ORDER BY schemaname,tablename,policyname) FROM pg_policies WHERE schemaname IN (SELECT name FROM scopes)),
  'audit_role',(SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolcanlogin,rolcreaterole,rolcreatedb,rolbypassrls) ORDER BY rolname) FROM pg_roles WHERE rolname='barber_audit_reader'),
  'extensions',(SELECT jsonb_agg(jsonb_build_array(extname,extversion) ORDER BY extname) FROM pg_extension WHERE extname<>'btree_gist'),
  'revision',(SELECT revision FROM app_meta.schema_build WHERE singleton)
);
