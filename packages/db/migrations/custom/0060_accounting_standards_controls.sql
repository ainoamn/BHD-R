-- Accounting standards controls: bank reconciliation markers on journal lines.
ALTER TABLE "journal_lines"
  ADD COLUMN IF NOT EXISTS "reconciled_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "reconciliation_id" uuid;

CREATE INDEX IF NOT EXISTS "journal_lines_recon_idx"
  ON "journal_lines" ("organization_id", "reconciled_at");

CREATE TABLE IF NOT EXISTS "bank_reconciliations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "account_code" varchar(16) NOT NULL DEFAULT '1100',
  "statement_on" date NOT NULL,
  "statement_balance_minor" bigint NOT NULL,
  "currency" varchar(3) NOT NULL DEFAULT 'OMR',
  "status" varchar(24) NOT NULL DEFAULT 'draft',
  "notes" text,
  "completed_at" timestamptz,
  "actor_user_id" uuid REFERENCES "users"("id")
);

CREATE INDEX IF NOT EXISTS "bank_reconciliations_org_idx"
  ON "bank_reconciliations" ("organization_id", "statement_on");

ALTER TABLE "bank_reconciliations" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bank_reconciliations' AND policyname = 'bank_reconciliations_tenant'
  ) THEN
    CREATE POLICY "bank_reconciliations_tenant" ON "bank_reconciliations"
      USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid)
      WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid);
  END IF;
END $$;

-- Link journal line reconciliation_id to sessions when present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journal_lines_reconciliation_fk'
  ) THEN
    ALTER TABLE "journal_lines"
      ADD CONSTRAINT "journal_lines_reconciliation_fk"
      FOREIGN KEY ("reconciliation_id") REFERENCES "bank_reconciliations"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
