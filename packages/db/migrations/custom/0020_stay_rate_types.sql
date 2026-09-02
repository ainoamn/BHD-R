-- Stay rate types: day-use + overnight-only alongside base overnight stay.
ALTER TABLE stay_rate_plans
  ADD COLUMN IF NOT EXISTS day_use_minor bigint,
  ADD COLUMN IF NOT EXISTS overnight_only_minor bigint;
