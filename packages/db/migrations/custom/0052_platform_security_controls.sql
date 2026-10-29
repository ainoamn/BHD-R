-- Platform security: auth attempts, IP quarantine, account locks, recovery challenges.
-- Additive only. IPs retained on security tables for fraud ops (hashed elsewhere for sessions).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS security_locked_at timestamptz;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS country_code varchar(2);

CREATE TABLE IF NOT EXISTS security_auth_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  outcome varchar(24) NOT NULL,
  source varchar(40) NOT NULL DEFAULT 'product',
  ip_address varchar(64),
  ip_hash varchar(64) NOT NULL,
  country_code varchar(2),
  user_agent_hash varchar(64),
  email_hash varchar(64),
  user_id uuid REFERENCES users(id),
  identity_subject varchar(200),
  reason varchar(80),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT security_auth_attempts_outcome_check
    CHECK (outcome IN ('success', 'failure', 'blocked', 'quarantined', 'locked'))
);

CREATE INDEX IF NOT EXISTS security_auth_attempts_ip_time_idx
  ON security_auth_attempts (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS security_auth_attempts_email_time_idx
  ON security_auth_attempts (email_hash, created_at DESC)
  WHERE email_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS security_auth_attempts_user_time_idx
  ON security_auth_attempts (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS security_auth_attempts_created_idx
  ON security_auth_attempts (created_at DESC);

CREATE TABLE IF NOT EXISTS security_ip_quarantines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address varchar(64),
  ip_hash varchar(64) NOT NULL,
  country_code varchar(2),
  reason varchar(160) NOT NULL,
  until_at timestamptz NOT NULL,
  released_at timestamptz,
  created_by_user_id uuid REFERENCES users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS security_ip_quarantines_active_idx
  ON security_ip_quarantines (ip_hash, until_at)
  WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS security_account_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES users(id),
  reason varchar(160) NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  unlocked_at timestamptz,
  unlocked_by varchar(40),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS security_account_locks_user_active_idx
  ON security_account_locks (user_id, locked_at DESC)
  WHERE unlocked_at IS NULL;

CREATE TABLE IF NOT EXISTS security_recovery_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES users(id),
  lock_id uuid REFERENCES security_account_locks(id),
  status varchar(24) NOT NULL DEFAULT 'pending',
  email_hash varchar(64) NOT NULL,
  civil_id_hash varchar(64) NOT NULL,
  dob_hash varchar(64) NOT NULL,
  id_expiry_hash varchar(64) NOT NULL,
  whatsapp_hash varchar(64) NOT NULL,
  last_txn_hash varchar(64) NOT NULL,
  email_otp_hash varchar(64),
  whatsapp_otp_hash varchar(64),
  email_otp_expires_at timestamptz,
  whatsapp_otp_expires_at timestamptz,
  email_verified_at timestamptz,
  whatsapp_verified_at timestamptz,
  whatsapp_channel varchar(24) NOT NULL DEFAULT 'deferred',
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT security_recovery_challenges_status_check
    CHECK (status IN ('pending', 'otp_sent', 'verified', 'consumed', 'expired', 'rejected')),
  CONSTRAINT security_recovery_challenges_whatsapp_channel_check
    CHECK (whatsapp_channel IN ('deferred', 'sent', 'skipped'))
);

CREATE INDEX IF NOT EXISTS security_recovery_challenges_user_idx
  ON security_recovery_challenges (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS security_identity_fingerprints (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  civil_id_hash varchar(64),
  dob_hash varchar(64),
  id_expiry_hash varchar(64),
  whatsapp_hash varchar(64),
  email_hash varchar(64)
);
