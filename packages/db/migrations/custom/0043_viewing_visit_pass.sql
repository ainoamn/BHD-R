-- Viewing visit pass: guest credentials, arrival stamp, and post-visit decision.
ALTER TABLE viewing_requests
  ADD COLUMN IF NOT EXISTS access_username varchar(64),
  ADD COLUMN IF NOT EXISTS access_pin varchar(12),
  ADD COLUMN IF NOT EXISTS arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS guest_decision varchar(24),
  ADD COLUMN IF NOT EXISTS guest_decision_at timestamptz;

CREATE INDEX IF NOT EXISTS viewing_requests_access_username_idx
  ON viewing_requests (organization_id, access_username)
  WHERE access_username IS NOT NULL;
