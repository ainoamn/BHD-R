-- Live sync: an append-only log of changed records, written by statement-level
-- triggers on business tables. Portals poll the newest id for their organization
-- (or for one stay booking) and refresh only when it moves. Every writer (web,
-- Nest, worker) is covered because the database records the change itself.

CREATE TABLE IF NOT EXISTS live_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  table_name text NOT NULL,
  resource_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_changes_org_id_idx ON live_changes (organization_id, id DESC);
CREATE INDEX IF NOT EXISTS live_changes_resource_idx
  ON live_changes (resource_id, id DESC)
  WHERE resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS live_changes_changed_at_idx ON live_changes (changed_at);

-- No policies: only the table owner (and BYPASSRLS roles) can read it.
ALTER TABLE live_changes ENABLE ROW LEVEL SECURITY;

-- TG_ARGV[0]: column copied into resource_id (stay child tables use booking_id).
CREATE OR REPLACE FUNCTION live_changes_capture() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  resource_column text := COALESCE(TG_ARGV[0], 'id');
  source_rows text := CASE WHEN TG_OP = 'DELETE' THEN 'old_rows' ELSE 'new_rows' END;
BEGIN
  EXECUTE format(
    'INSERT INTO public.live_changes (organization_id, table_name, resource_id)
     SELECT DISTINCT organization_id, %L, %I FROM %I WHERE organization_id IS NOT NULL',
    TG_TABLE_NAME,
    resource_column,
    source_rows
  );
  -- Keep the log short without a separate job.
  IF random() < 0.002 THEN
    DELETE FROM public.live_changes WHERE changed_at < now() - interval '2 days';
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  target text;
  resource_column text;
  targets text[] := ARRAY[
    'properties', 'property_profiles', 'property_amenities', 'property_documents',
    'property_ownership_interests', 'units', 'unit_media', 'utility_meters', 'listings',
    'parties', 'party_roles', 'memberships', 'vendors',
    'leases', 'contracts', 'contract_signatures', 'contract_templates',
    'invoices', 'invoice_lines', 'payments', 'receipts', 'refunds', 'cheques', 'expenses',
    'billing_schedules', 'journal_entries', 'ledger_accounts',
    'maintenance_tickets', 'maintenance_work_orders', 'work_tasks', 'operational_requests',
    'reservations', 'viewing_requests', 'rental_applications', 'approval_requests',
    'sales_deals', 'leads', 'legal_cases', 'legal_events',
    'stay_bookings', 'stay_booking_status_history', 'stay_booking_guests',
    'stay_payment_intents', 'stay_folios', 'stay_charges', 'stay_refunds', 'stay_reviews',
    'stay_housekeeping_tasks', 'stay_holds', 'stay_inventory_days', 'stay_public_listings',
    'stay_profiles', 'stay_unit_types', 'stay_rate_plans', 'stay_rate_rules', 'stay_policies',
    'stay_fees'
  ];
BEGIN
  FOREACH target IN ARRAY targets LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = target AND column_name = 'organization_id'
    ) THEN
      CONTINUE;
    END IF;

    resource_column := 'id';
    IF target LIKE 'stay\_%' AND target <> 'stay_bookings' AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = target
        AND column_name = 'booking_id' AND data_type = 'uuid'
    ) THEN
      resource_column := 'booking_id';
    END IF;

    EXECUTE format(
      'CREATE OR REPLACE TRIGGER live_changes_ins AFTER INSERT ON %I
         REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION live_changes_capture(%L)',
      target, resource_column
    );
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER live_changes_upd AFTER UPDATE ON %I
         REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION live_changes_capture(%L)',
      target, resource_column
    );
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER live_changes_del AFTER DELETE ON %I
         REFERENCING OLD TABLE AS old_rows
         FOR EACH STATEMENT EXECUTE FUNCTION live_changes_capture(%L)',
      target, resource_column
    );
  END LOOP;
END;
$$;
