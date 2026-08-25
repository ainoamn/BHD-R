ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_recovery_digests" jsonb DEFAULT '[]'::jsonb NOT NULL;
