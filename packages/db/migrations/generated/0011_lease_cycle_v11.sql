-- Cycle rules v1.1: lease cancel clearance + renewal accountant gate columns
ALTER TYPE "lease_status" ADD VALUE IF NOT EXISTS 'cancel_requested';--> statement-breakpoint
ALTER TYPE "lease_status" ADD VALUE IF NOT EXISTS 'clearance_pending';--> statement-breakpoint
ALTER TYPE "lease_status" ADD VALUE IF NOT EXISTS 'cancelled';--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "exit_kind" varchar(16);--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "cancellation_source" varchar(16);--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "cancellation_proposed_on" date;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "cancellation_effective_on" date;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "cancellation_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "cancellation_requested_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "cancellation_admin_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "cancellation_admin_approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "cancellation_cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "cancellation_cleared_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "cancellation_clearance_note" text;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "renewal_pending_contract_id" uuid;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "renewal_pending_ends_on" date;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "renewal_pending_rent_minor" bigint;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "renewal_gate_waived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN IF NOT EXISTS "renewal_gate_waived_by_user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leases" ADD CONSTRAINT "leases_cancellation_requested_by_user_id_users_id_fk"
    FOREIGN KEY ("cancellation_requested_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leases" ADD CONSTRAINT "leases_cancellation_admin_approved_by_user_id_users_id_fk"
    FOREIGN KEY ("cancellation_admin_approved_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leases" ADD CONSTRAINT "leases_cancellation_cleared_by_user_id_users_id_fk"
    FOREIGN KEY ("cancellation_cleared_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leases" ADD CONSTRAINT "leases_renewal_pending_contract_id_contracts_id_fk"
    FOREIGN KEY ("renewal_pending_contract_id") REFERENCES "public"."contracts"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leases" ADD CONSTRAINT "leases_renewal_gate_waived_by_user_id_users_id_fk"
    FOREIGN KEY ("renewal_gate_waived_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leases_org_status_idx" ON "leases" USING btree ("organization_id","status");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leases" ADD CONSTRAINT "leases_exit_kind_check"
    CHECK ("exit_kind" IS NULL OR "exit_kind" IN ('cancel', 'end'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leases" ADD CONSTRAINT "leases_cancellation_source_check"
    CHECK ("cancellation_source" IS NULL OR "cancellation_source" IN ('tenant', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
