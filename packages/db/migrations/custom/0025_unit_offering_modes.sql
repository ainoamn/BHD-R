-- Offering modes per unit (sale / monthly / yearly / daily), CSV.
-- Keep schema changes here, never in request paths: ALTER takes ACCESS EXCLUSIVE on units.
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS offering_modes varchar(64) NOT NULL DEFAULT 'monthly';
