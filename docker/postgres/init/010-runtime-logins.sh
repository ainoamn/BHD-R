#!/usr/bin/env bash

: "${BHD_R_API_DB_PASSWORD:?BHD_R_API_DB_PASSWORD is required}"
: "${BHD_R_SYSTEM_DB_PASSWORD:?BHD_R_SYSTEM_DB_PASSWORD is required}"
: "${BHD_R_WORKER_DB_PASSWORD:?BHD_R_WORKER_DB_PASSWORD is required}"

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set api_password="$BHD_R_API_DB_PASSWORD" \
  --set system_password="$BHD_R_SYSTEM_DB_PASSWORD" \
  --set worker_password="$BHD_R_WORKER_DB_PASSWORD" <<-'EOSQL'
SELECT 'CREATE ROLE bhd_r_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bhd_r_app') \gexec

SELECT 'CREATE ROLE bhd_r_system NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bhd_r_system') \gexec

SELECT 'CREATE ROLE bhd_r_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bhd_r_worker') \gexec

SELECT format(
  'CREATE ROLE bhd_r_api_login LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS',
  :'api_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bhd_r_api_login') \gexec

SELECT format(
  'CREATE ROLE bhd_r_system_login LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS',
  :'system_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bhd_r_system_login') \gexec

SELECT format(
  'CREATE ROLE bhd_r_worker_login LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS',
  :'worker_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bhd_r_worker_login') \gexec

SELECT format('ALTER ROLE bhd_r_api_login PASSWORD %L', :'api_password') \gexec
SELECT format('ALTER ROLE bhd_r_system_login PASSWORD %L', :'system_password') \gexec
SELECT format('ALTER ROLE bhd_r_worker_login PASSWORD %L', :'worker_password') \gexec

GRANT bhd_r_app TO bhd_r_api_login;
GRANT bhd_r_system TO bhd_r_system_login;
GRANT bhd_r_worker TO bhd_r_worker_login;

GRANT CONNECT ON DATABASE bhd_r TO bhd_r_api_login, bhd_r_system_login, bhd_r_worker_login;
EOSQL
