-- Enrich sessions for admin dossiers: device class/label, coarse geo, and login IP.
-- Additive only. Existing rows stay null until the next sign-in.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS device_kind varchar(16),
  ADD COLUMN IF NOT EXISTS device_label varchar(120),
  ADD COLUMN IF NOT EXISTS region varchar(80),
  ADD COLUMN IF NOT EXISTS city varchar(120),
  ADD COLUMN IF NOT EXISTS ip_address varchar(64);

ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_device_kind_check;
ALTER TABLE sessions
  ADD CONSTRAINT sessions_device_kind_check
  CHECK (device_kind IS NULL OR device_kind IN ('phone', 'tablet', 'desktop', 'unknown'));
