ALTER TABLE "users" ADD COLUMN "totp_recovery_digests" jsonb DEFAULT '[]'::jsonb NOT NULL;
