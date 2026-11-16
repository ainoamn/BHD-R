-- Owner-facing property number + how it appears with the title on public listings.
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "display_number" varchar(80);
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "listing_label_mode" varchar(24) NOT NULL DEFAULT 'title';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'properties_listing_label_mode_check'
  ) THEN
    ALTER TABLE "properties"
      ADD CONSTRAINT "properties_listing_label_mode_check"
      CHECK ("listing_label_mode" IN ('title', 'number', 'both'));
  END IF;
END $$;
