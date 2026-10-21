-- Morning / day-use check-in start time (pairs with day_use_check_out_until).
ALTER TABLE stay_profiles
  ADD COLUMN IF NOT EXISTS day_use_check_in_from varchar(8);

UPDATE stay_profiles
SET day_use_check_in_from = COALESCE(day_use_check_in_from, '10:00')
WHERE day_use_check_in_from IS NULL;
