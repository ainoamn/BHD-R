CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'converted', 'lost', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."rental_application_status" AS ENUM('draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn', 'converted');
--> statement-breakpoint
CREATE TYPE "public"."cheque_review_status" AS ENUM('pending', 'accepted', 'rejected', 'deposited', 'cleared', 'bounced', 'cancelled');
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "rent_minor" bigint;
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "currency" varchar(3);
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "terms_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "holds_one_active_per_unit" ON "holds" USING btree ("unit_id") WHERE "status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reservations_one_active_per_unit" ON "reservations" USING btree ("unit_id") WHERE "status" IN ('pending', 'confirmed');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "party_id" uuid,
  "unit_id" uuid,
  "source" varchar(80) DEFAULT 'website' NOT NULL,
  "status" "lead_status" DEFAULT 'new' NOT NULL,
  "display_name" varchar(200) NOT NULL,
  "email" varchar(320),
  "phone" varchar(40),
  "assigned_to_user_id" uuid,
  "notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rental_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "applicant_party_id" uuid NOT NULL,
  "viewing_request_id" uuid,
  "reservation_id" uuid,
  "status" "rental_application_status" DEFAULT 'draft' NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cheques" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "reservation_id" uuid,
  "lease_id" uuid,
  "owner_party_id" uuid NOT NULL,
  "bank_name" varchar(160) NOT NULL,
  "cheque_number" varchar(80) NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" varchar(3) NOT NULL,
  "due_on" date NOT NULL,
  "attachment_media_id" uuid,
  "review_status" "cheque_review_status" DEFAULT 'pending' NOT NULL,
  "reviewed_by_user_id" uuid,
  "reviewed_at" timestamptz,
  "review_notes" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_applications" ADD CONSTRAINT "rental_applications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_applications" ADD CONSTRAINT "rental_applications_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_applications" ADD CONSTRAINT "rental_applications_applicant_party_id_parties_id_fk" FOREIGN KEY ("applicant_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_applications" ADD CONSTRAINT "rental_applications_viewing_request_id_viewing_requests_id_fk" FOREIGN KEY ("viewing_request_id") REFERENCES "public"."viewing_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_applications" ADD CONSTRAINT "rental_applications_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cheques" ADD CONSTRAINT "cheques_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cheques" ADD CONSTRAINT "cheques_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cheques" ADD CONSTRAINT "cheques_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cheques" ADD CONSTRAINT "cheques_owner_party_id_parties_id_fk" FOREIGN KEY ("owner_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cheques" ADD CONSTRAINT "cheques_attachment_media_id_media_assets_id_fk" FOREIGN KEY ("attachment_media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cheques" ADD CONSTRAINT "cheques_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_org_status_idx" ON "leads" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_org_idx" ON "leads" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_applications_org_status_idx" ON "rental_applications" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_applications_unit_idx" ON "rental_applications" USING btree ("unit_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cheques_org_number_unique" ON "cheques" USING btree ("organization_id","cheque_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cheques_org_status_idx" ON "cheques" USING btree ("organization_id","review_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cheques_due_idx" ON "cheques" USING btree ("organization_id","due_on");
