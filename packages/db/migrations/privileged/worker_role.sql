-- Run once as a PostgreSQL administrator. Application migrations intentionally do not require CREATEROLE.
DO $worker_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bhd_r_worker') THEN
    CREATE ROLE bhd_r_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $worker_role$;

GRANT USAGE ON SCHEMA public, app_private TO bhd_r_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO bhd_r_worker;
GRANT SELECT ON
  outbox_events, media_assets, unit_media, units, contracts, contract_templates, invoices,
  credential_tokens, users, report_jobs, properties, leases, payments, maintenance_tickets,
  sales_deals, legal_cases, work_tasks, operational_requests, ledger_accounts, journal_entries,
  journal_sequences, journal_lines, expenses, parties, addresses, party_roles, party_addresses,
  representation_authorities, billing_schedules, payment_sessions, refunds, receipts,
  receipt_sequences, contract_sequences
TO bhd_r_worker;
GRANT UPDATE (published_at, attempts) ON outbox_events TO bhd_r_worker;
GRANT UPDATE (processing_status, scan_status, private_object_key, public_object_key, metadata, sha256, updated_at) ON media_assets TO bhd_r_worker;
GRANT UPDATE (rendered_pdf_object_key, rendered_pdf_hash, updated_at) ON contracts TO bhd_r_worker;
GRANT UPDATE (rendered_pdf_object_key, rendered_pdf_hash, updated_at) ON invoices TO bhd_r_worker;
GRANT UPDATE (rendered_pdf_object_key, rendered_pdf_hash, updated_at) ON receipts TO bhd_r_worker;
GRANT UPDATE (status, object_key, expires_at, updated_at) ON report_jobs TO bhd_r_worker;

-- Example after the deployment login role has been provisioned by the platform:
-- GRANT bhd_r_worker TO bhd_r_worker_login;
