-- Stay profile: period times, guest caps, deposit, policies & instructions.
ALTER TABLE stay_profiles
  ADD COLUMN IF NOT EXISTS day_use_check_out_until varchar(8),
  ADD COLUMN IF NOT EXISTS overnight_check_out_until varchar(8),
  ADD COLUMN IF NOT EXISTS day_use_max_guests integer,
  ADD COLUMN IF NOT EXISTS overnight_max_guests integer,
  ADD COLUMN IF NOT EXISTS deposit_minor bigint,
  ADD COLUMN IF NOT EXISTS policies_ar text,
  ADD COLUMN IF NOT EXISTS policies_en text,
  ADD COLUMN IF NOT EXISTS policies_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS instructions_ar text,
  ADD COLUMN IF NOT EXISTS instructions_en text;

UPDATE stay_profiles
SET
  overnight_check_out_until = COALESCE(overnight_check_out_until, check_out_until),
  overnight_max_guests = COALESCE(overnight_max_guests, max_guests),
  day_use_max_guests = COALESCE(day_use_max_guests, max_guests),
  day_use_check_out_until = COALESCE(day_use_check_out_until, '23:00')
WHERE overnight_check_out_until IS NULL
   OR overnight_max_guests IS NULL
   OR day_use_max_guests IS NULL
   OR day_use_check_out_until IS NULL;
