-- Half-day stay slots: morning (day_use) and evening (overnight_only) may coexist.
-- overnight_stay / full locks still block the whole day.

ALTER TABLE stay_inventory_locks
  ADD COLUMN IF NOT EXISTS lock_slot varchar(16) NOT NULL DEFAULT 'full';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stay_inventory_locks_slot_check'
  ) THEN
    ALTER TABLE stay_inventory_locks
      ADD CONSTRAINT stay_inventory_locks_slot_check
      CHECK (lock_slot IN ('morning', 'evening', 'full'));
  END IF;
END $$;

-- Replace GiST exclusion with slot-aware trigger.
ALTER TABLE stay_inventory_locks
  DROP CONSTRAINT IF EXISTS stay_inventory_locks_no_overlap_active;

CREATE OR REPLACE FUNCTION stay_inventory_lock_slot_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conflicting integer;
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::int INTO conflicting
  FROM stay_inventory_locks l
  WHERE l.unit_id = NEW.unit_id
    AND l.status = 'active'
    AND l.id IS DISTINCT FROM NEW.id
    AND l.stay_range && NEW.stay_range
    AND (
      l.lock_slot = 'full'
      OR NEW.lock_slot = 'full'
      OR l.lock_slot = NEW.lock_slot
    );

  IF conflicting > 0 THEN
    RAISE EXCEPTION 'stay_inventory_locks_slot_conflict'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stay_inventory_locks_slot_guard_trg ON stay_inventory_locks;
CREATE TRIGGER stay_inventory_locks_slot_guard_trg
  BEFORE INSERT OR UPDATE OF stay_range, status, lock_slot, unit_id
  ON stay_inventory_locks
  FOR EACH ROW
  EXECUTE FUNCTION stay_inventory_lock_slot_guard();
