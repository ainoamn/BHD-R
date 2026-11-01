-- Site-owned ledger for SaaS collections and platform operating expenses.
-- Additive only. Not organization-scoped; site admins manage via elevated access.

CREATE TABLE IF NOT EXISTS platform_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  occurred_on date NOT NULL,
  kind varchar(32) NOT NULL,
  category varchar(80) NOT NULL,
  description varchar(500) NOT NULL,
  amount_minor bigint NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'OMR',
  minor_unit integer NOT NULL DEFAULT 3,
  organization_id uuid REFERENCES organizations(id),
  reference varchar(120),
  status varchar(16) NOT NULL DEFAULT 'posted',
  created_by_user_id uuid REFERENCES users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT platform_ledger_kind_check
    CHECK (kind IN ('subscription_in', 'other_in', 'expense', 'adjustment')),
  CONSTRAINT platform_ledger_status_check
    CHECK (status IN ('draft', 'posted', 'void')),
  CONSTRAINT platform_ledger_amount_check
    CHECK (amount_minor > 0),
  CONSTRAINT platform_ledger_minor_unit_check
    CHECK (minor_unit BETWEEN 0 AND 6)
);

CREATE INDEX IF NOT EXISTS platform_ledger_occurred_idx
  ON platform_ledger_entries (occurred_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_ledger_kind_status_idx
  ON platform_ledger_entries (kind, status);
CREATE INDEX IF NOT EXISTS platform_ledger_org_idx
  ON platform_ledger_entries (organization_id)
  WHERE organization_id IS NOT NULL;
