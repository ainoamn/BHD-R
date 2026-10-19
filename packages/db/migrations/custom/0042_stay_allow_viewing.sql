-- Owner can allow or block public viewing requests on daily-stay units.
ALTER TABLE stay_profiles
  ADD COLUMN IF NOT EXISTS allow_viewing_requests boolean NOT NULL DEFAULT true;
