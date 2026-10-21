-- Default stay period clocks: morning 10:00–22:00, evening/overnight 23:00–09:00.
UPDATE stay_profiles
SET
  day_use_check_in_from = COALESCE(day_use_check_in_from, '10:00'),
  day_use_check_out_until = COALESCE(day_use_check_out_until, '22:00'),
  check_in_from = COALESCE(check_in_from, '23:00'),
  overnight_check_out_until = COALESCE(overnight_check_out_until, check_out_until, '09:00'),
  check_out_until = COALESCE(check_out_until, overnight_check_out_until, '09:00');

-- Refresh previous product defaults to the new clocks.
UPDATE stay_profiles
SET
  day_use_check_in_from = '10:00'
WHERE day_use_check_in_from IS NULL
   OR day_use_check_in_from IN ('08:00', '8:00');

UPDATE stay_profiles
SET
  day_use_check_out_until = '22:00'
WHERE day_use_check_out_until IS NULL
   OR day_use_check_out_until IN ('23:00');

UPDATE stay_profiles
SET
  check_in_from = '23:00'
WHERE check_in_from IS NULL
   OR check_in_from IN ('15:00');

UPDATE stay_profiles
SET
  overnight_check_out_until = '09:00',
  check_out_until = '09:00'
WHERE COALESCE(overnight_check_out_until, check_out_until) IS NULL
   OR COALESCE(overnight_check_out_until, check_out_until) IN ('11:00', '12:00');
