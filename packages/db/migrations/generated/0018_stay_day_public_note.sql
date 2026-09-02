-- Per-day public note + preserve custom rates across inventory rebuilds.
ALTER TABLE "stay_inventory_days"
  ADD COLUMN IF NOT EXISTS "public_note" text,
  ADD COLUMN IF NOT EXISTS "manual_rate" boolean NOT NULL DEFAULT false;
