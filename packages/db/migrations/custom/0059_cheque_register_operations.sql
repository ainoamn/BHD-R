-- PDC cheque register: canonical statuses, operation log, intermediate lifecycle dates.
-- Old enum values remain for compatibility; rows are normalized to the new set.

ALTER TYPE "cheque_review_status" ADD VALUE IF NOT EXISTS 'in_hand';
ALTER TYPE "cheque_review_status" ADD VALUE IF NOT EXISTS 'under_collection';

ALTER TABLE "cheques"
  ADD COLUMN IF NOT EXISTS "bounce_reason" varchar(80),
  ADD COLUMN IF NOT EXISTS "received_on" date,
  ADD COLUMN IF NOT EXISTS "deposited_on" date,
  ADD COLUMN IF NOT EXISTS "cleared_on" date,
  ADD COLUMN IF NOT EXISTS "bank_account_memo" varchar(160);

-- Normalize legacy statuses into the PDC register model.
UPDATE "cheques"
SET "review_status" = 'in_hand'
WHERE "review_status"::text IN ('pending', 'accepted', 'postponed');

UPDATE "cheques"
SET "review_status" = 'under_collection'
WHERE "review_status"::text = 'deposited';

UPDATE "cheques"
SET
  "review_status" = 'bounced',
  "bounce_reason" = COALESCE(NULLIF(TRIM("bounce_reason"), ''), 'insufficient_funds')
WHERE "review_status"::text = 'insufficient_funds';

UPDATE "cheques"
SET "review_status" = 'cleared'
WHERE "review_status"::text = 'partially_cleared';

UPDATE "cheques"
SET "review_status" = 'cancelled'
WHERE "review_status"::text = 'rejected';

UPDATE "cheques"
SET "received_on" = COALESCE("received_on", "due_on")
WHERE "review_status"::text IN ('in_hand', 'under_collection', 'cleared', 'bounced', 'cancelled')
  AND "received_on" IS NULL;

UPDATE "cheques"
SET "deposited_on" = COALESCE("deposited_on", "due_on")
WHERE "review_status"::text IN ('under_collection', 'cleared', 'bounced')
  AND "deposited_on" IS NULL;

UPDATE "cheques"
SET "cleared_on" = COALESCE("cleared_on", ("reviewed_at" AT TIME ZONE 'Asia/Muscat')::date, "due_on")
WHERE "review_status"::text = 'cleared'
  AND "cleared_on" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cheque_operation_type') THEN
    CREATE TYPE "cheque_operation_type" AS ENUM (
      'receive',
      'deposit',
      'collect',
      'bounce',
      'redeposit',
      'cancel',
      'postpone',
      'undo'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "cheque_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "cheque_id" uuid NOT NULL REFERENCES "cheques"("id") ON DELETE CASCADE,
  "operation" "cheque_operation_type" NOT NULL,
  "from_status" "cheque_review_status",
  "to_status" "cheque_review_status",
  "occurred_on" date NOT NULL,
  "amount_minor" bigint,
  "notes" text,
  "bounce_reason" varchar(80),
  "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "actor_user_id" uuid REFERENCES "users"("id"),
  "undone_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "cheque_operations_cheque_idx"
  ON "cheque_operations" ("cheque_id", "created_at");
CREATE INDEX IF NOT EXISTS "cheque_operations_org_idx"
  ON "cheque_operations" ("organization_id", "occurred_on");

ALTER TABLE "cheque_operations" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cheque_operations' AND policyname = 'cheque_operations_tenant'
  ) THEN
    CREATE POLICY "cheque_operations_tenant" ON "cheque_operations"
      USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid)
      WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid);
  END IF;
END $$;
