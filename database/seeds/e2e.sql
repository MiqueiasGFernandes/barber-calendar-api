INSERT INTO tenancy.tenants(id,name,slug,status,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000001','Barbearia Seed','barbearia-seed','active',now(),now());
INSERT INTO identity.user_accounts(id,email,normalized_email,email_verified_at,status,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000002','member@example.test','member@example.test',now(),'active',now(),now());
INSERT INTO tenancy.tenant_memberships(id,tenant_id,user_id,role,status,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','member','active',now(),now());

