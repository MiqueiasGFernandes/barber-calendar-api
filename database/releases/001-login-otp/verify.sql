\set ON_ERROR_STOP on
SELECT 1/CASE WHEN to_regclass('identity.sessions_authorization_idx') IS NOT NULL THEN 1 ELSE 0 END;

