\set ON_ERROR_STOP on

CREATE ROLE bhd_r_api_login
  LOGIN PASSWORD :'api_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;

CREATE ROLE bhd_r_system_login
  LOGIN PASSWORD :'system_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;

CREATE ROLE bhd_r_worker_login
  LOGIN PASSWORD :'worker_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;

GRANT bhd_r_app TO bhd_r_api_login;
GRANT bhd_r_system TO bhd_r_system_login;
GRANT bhd_r_worker TO bhd_r_worker_login;

GRANT CONNECT ON DATABASE bhd_r TO bhd_r_api_login, bhd_r_system_login, bhd_r_worker_login;
