-- Run once as a PostgreSQL administrator, after the generated tables exist.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bhd_r_app') THEN
    CREATE ROLE bhd_r_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bhd_r_system') THEN
    CREATE ROLE bhd_r_system NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $roles$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA public, app_private TO bhd_r_app, bhd_r_system;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO bhd_r_app, bhd_r_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bhd_r_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bhd_r_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bhd_r_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bhd_r_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bhd_r_app, bhd_r_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bhd_r_app, bhd_r_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private GRANT EXECUTE ON FUNCTIONS TO bhd_r_app, bhd_r_system;

-- Replace these examples with secrets created by the deployment platform:
-- Ensure login roles are INHERIT before granting memberships (important on PostgreSQL 17+).
-- ALTER ROLE bhd_r_api_login INHERIT;
-- ALTER ROLE bhd_r_system_login INHERIT;
-- GRANT bhd_r_app TO bhd_r_api_login;
-- GRANT bhd_r_system TO bhd_r_system_login;
