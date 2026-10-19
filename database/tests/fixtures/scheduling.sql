BEGIN;
INSERT INTO tenancy.tenants(id,name,slug,status,created_at,updated_at) VALUES
('10000000-0000-4000-8000-000000000001','Barbearia Exemplo A','fixture-a','active',now(),now()),
('10000000-0000-4000-8000-000000000002','Barbearia Exemplo B','fixture-b','active',now(),now()) ON CONFLICT DO NOTHING;
INSERT INTO scheduling.tenant_settings(tenant_id) VALUES
('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002') ON CONFLICT DO NOTHING;
INSERT INTO identity.user_accounts(id,email,normalized_email,email_verified_at,status,created_at,updated_at) VALUES
('20000000-0000-4000-8000-000000000001','admin-a@example.test','admin-a@example.test',now(),'active',now(),now()),
('20000000-0000-4000-8000-000000000002','member-a@example.test','member-a@example.test',now(),'active',now(),now()) ON CONFLICT DO NOTHING;
INSERT INTO tenancy.tenant_memberships(id,tenant_id,user_id,role,status,created_at,updated_at) VALUES
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','administrator','active',now(),now()),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','member','active',now(),now()) ON CONFLICT DO NOTHING;
INSERT INTO scheduling.services(id,tenant_id,name,duration_minutes,price_minor,currency,status,created_at,updated_at) VALUES
('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Corte de exemplo',30,5000,'BRL','active',now(),now()) ON CONFLICT DO NOTHING;
INSERT INTO scheduling.professionals(id,tenant_id,name,status,created_at,updated_at) VALUES
('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Profissional Exemplo','active',now(),now()) ON CONFLICT DO NOTHING;
INSERT INTO scheduling.professional_services(tenant_id,professional_id,service_id,created_at) VALUES
('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',now()) ON CONFLICT DO NOTHING;
INSERT INTO scheduling.weekly_periods(id,tenant_id,professional_id,iso_weekday,starts_at,ends_at,created_at,updated_at) VALUES
('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1,'09:00','17:00',now(),now()) ON CONFLICT DO NOTHING;
INSERT INTO scheduling.appointments(id,public_id,tenant_id,professional_id,service_id,starts_at,ends_at,status,customer_name,customer_phone,customer_email,service_name_snapshot,duration_minutes_snapshot,price_minor_snapshot,currency_snapshot,created_at,updated_at) VALUES
('70000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','2030-01-07 12:00:00+00','2030-01-07 12:30:00+00','confirmed','Cliente Exemplo','+5511999999999','client@example.test','Corte de exemplo',30,5000,'BRL',now(),now()) ON CONFLICT DO NOTHING;
COMMIT;
