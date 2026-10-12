-- Deposit receipt confirmation, guest claims and site-admin complaints (0.8.19). Additive only.
--
-- stay_refunds: what has been transferred so far (a claim may add to the refund or void a
-- transfer the guest never received), when the accountant recorded the last transfer, and the
-- guest's answer to it. With no answer within 24 hours the transfer counts as received.

ALTER TABLE stay_refunds ADD COLUMN IF NOT EXISTS paid_minor bigint NOT NULL DEFAULT 0;
ALTER TABLE stay_refunds ADD COLUMN IF NOT EXISTS transfer_recorded_at timestamptz;
ALTER TABLE stay_refunds ADD COLUMN IF NOT EXISTS guest_receipt varchar(16);
ALTER TABLE stay_refunds ADD COLUMN IF NOT EXISTS guest_receipt_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stay_refunds_guest_receipt_check'
  ) THEN
    ALTER TABLE stay_refunds ADD CONSTRAINT stay_refunds_guest_receipt_check
      CHECK (guest_receipt IS NULL OR guest_receipt IN ('confirmed', 'not_received'));
  END IF;
END;
$$;

-- Transfers recorded before 0.8.19 were paid in full.
UPDATE stay_refunds
SET paid_minor = amount_minor,
    transfer_recorded_at = coalesce(transfer_recorded_at, executed_at, updated_at)
WHERE status = 'executed' AND paid_minor = 0;

-- A guest's request or objection about the deposit, answered by the host; when the guest is
-- not satisfied it is escalated to the site administration as a complaint.
CREATE TABLE IF NOT EXISTS stay_deposit_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  booking_id uuid NOT NULL REFERENCES stay_bookings(id),
  property_id uuid NOT NULL REFERENCES properties(id),
  refund_id uuid REFERENCES stay_refunds(id),
  kind varchar(16) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'open',
  amount_minor bigint,
  currency varchar(3) NOT NULL,
  message text NOT NULL,
  response varchar(16),
  response_note text,
  response_amount_minor bigint,
  responded_at timestamptz,
  responded_by_user_id uuid REFERENCES users(id),
  responded_by_name varchar(160),
  escalated_at timestamptz,
  escalation_message text,
  resolution varchar(16),
  resolution_note text,
  resolution_amount_minor bigint,
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES users(id),
  resolved_by_name varchar(160),
  CONSTRAINT stay_deposit_claims_kind_check
    CHECK (kind IN ('not_received', 'deduction', 'other')),
  CONSTRAINT stay_deposit_claims_status_check
    CHECK (status IN ('open', 'accepted', 'rejected', 'escalated', 'resolved')),
  CONSTRAINT stay_deposit_claims_response_check
    CHECK (response IS NULL OR response IN ('accepted', 'rejected')),
  CONSTRAINT stay_deposit_claims_resolution_check
    CHECK (resolution IS NULL OR resolution IN ('guest', 'host')),
  CONSTRAINT stay_deposit_claims_amounts_check
    CHECK (
      coalesce(amount_minor, 0) >= 0
      AND coalesce(response_amount_minor, 0) >= 0
      AND coalesce(resolution_amount_minor, 0) >= 0
    )
);

CREATE INDEX IF NOT EXISTS stay_deposit_claims_booking_idx
  ON stay_deposit_claims (booking_id, created_at);
CREATE INDEX IF NOT EXISTS stay_deposit_claims_org_status_idx
  ON stay_deposit_claims (organization_id, status);
CREATE INDEX IF NOT EXISTS stay_deposit_claims_escalated_idx
  ON stay_deposit_claims (status, escalated_at) WHERE escalated_at IS NOT NULL;

ALTER TABLE stay_deposit_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE stay_deposit_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stay_deposit_claims_isolation ON stay_deposit_claims;
CREATE POLICY stay_deposit_claims_isolation ON stay_deposit_claims
USING (
  app_private.is_platform_admin()
  OR organization_id = app_private.current_organization_id()
)
WITH CHECK (
  app_private.is_platform_admin()
  OR organization_id = app_private.current_organization_id()
);

-- Platform-wide settings (for example who receives guest complaints, and how).
CREATE TABLE IF NOT EXISTS platform_settings (
  key varchar(64) PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id)
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_settings_admin ON platform_settings;
CREATE POLICY platform_settings_admin ON platform_settings
USING (app_private.is_platform_admin())
WITH CHECK (app_private.is_platform_admin());

-- Live sync: a claim change refreshes the booking's portals and the guest page.
DO $$
BEGIN
  IF to_regprocedure('live_changes_capture()') IS NOT NULL THEN
    CREATE OR REPLACE TRIGGER live_changes_ins AFTER INSERT ON stay_deposit_claims
      REFERENCING NEW TABLE AS new_rows
      FOR EACH STATEMENT EXECUTE FUNCTION live_changes_capture('booking_id');
    CREATE OR REPLACE TRIGGER live_changes_upd AFTER UPDATE ON stay_deposit_claims
      REFERENCING NEW TABLE AS new_rows
      FOR EACH STATEMENT EXECUTE FUNCTION live_changes_capture('booking_id');
  END IF;
END;
$$;
