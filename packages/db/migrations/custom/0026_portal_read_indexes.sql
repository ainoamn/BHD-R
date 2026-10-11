-- Read-path indexes for owner portal loaders (overview, property pulse, approvals, ops lists).
-- Idempotent; kept out of the Drizzle snapshot so `drizzle-kit generate` never re-emits them.
CREATE INDEX IF NOT EXISTS workflow_events_org_time_idx
  ON workflow_events (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS stay_payment_intents_booking_idx
  ON stay_payment_intents (booking_id);
CREATE INDEX IF NOT EXISTS contracts_unit_idx
  ON contracts (unit_id);
CREATE INDEX IF NOT EXISTS stay_bookings_property_check_in_idx
  ON stay_bookings (property_id, check_in_on);
CREATE INDEX IF NOT EXISTS stay_bookings_org_created_idx
  ON stay_bookings (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_org_status_due_idx
  ON invoices (organization_id, status, due_on);
CREATE INDEX IF NOT EXISTS invoices_lease_idx
  ON invoices (lease_id);
CREATE INDEX IF NOT EXISTS maintenance_org_status_idx
  ON maintenance_tickets (organization_id, status);
CREATE INDEX IF NOT EXISTS expenses_org_issued_idx
  ON expenses (organization_id, issued_on DESC);
