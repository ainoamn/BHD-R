-- Owner can choose automatic vs manual approval of guest stay date/period changes.
ALTER TABLE stay_profiles
  ADD COLUMN IF NOT EXISTS auto_approve_reschedule boolean NOT NULL DEFAULT true;
