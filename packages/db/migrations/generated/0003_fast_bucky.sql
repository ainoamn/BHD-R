CREATE TYPE "public"."billing_schedule_status" AS ENUM('pending_activation', 'active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_session_status" AS ENUM('created', 'redirected', 'completed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "billing_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"status" "billing_schedule_status" DEFAULT 'pending_activation' NOT NULL,
	"frequency" varchar(24) DEFAULT 'monthly' NOT NULL,
	"billing_day" integer NOT NULL,
	"due_days" integer DEFAULT 7 NOT NULL,
	"tax_rate_basis_points" integer DEFAULT 0 NOT NULL,
	"description_ar" varchar(300) NOT NULL,
	"description_en" varchar(300) NOT NULL,
	"next_issue_on" date NOT NULL,
	"last_issued_on" date,
	CONSTRAINT "billing_schedules_frequency_check" CHECK ("billing_schedules"."frequency" IN ('monthly')),
	CONSTRAINT "billing_schedules_billing_day_check" CHECK ("billing_schedules"."billing_day" BETWEEN 1 AND 28),
	CONSTRAINT "billing_schedules_due_days_check" CHECK ("billing_schedules"."due_days" BETWEEN 0 AND 90),
	CONSTRAINT "billing_schedules_tax_rate_check" CHECK ("billing_schedules"."tax_rate_basis_points" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "contract_sequences" (
	"organization_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "contract_sequences_organization_id_year_pk" PRIMARY KEY("organization_id","year")
);
--> statement-breakpoint
CREATE TABLE "party_addresses" (
	"organization_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"address_id" uuid NOT NULL,
	"label" varchar(40) DEFAULT 'primary' NOT NULL,
	"primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_addresses_party_id_address_id_pk" PRIMARY KEY("party_id","address_id")
);
--> statement-breakpoint
CREATE TABLE "party_identity_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"document_type" varchar(40) NOT NULL,
	"number_encrypted" text NOT NULL,
	"number_lookup_hash" varchar(64) NOT NULL,
	"number_last4" varchar(4) NOT NULL,
	"issuing_country_code" varchar(2) DEFAULT 'OM' NOT NULL,
	"issued_on" date,
	"expires_on" date,
	"verification_status" varchar(24) DEFAULT 'pending' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "party_identity_documents_type_check" CHECK ("party_identity_documents"."document_type" IN ('civil_id', 'passport', 'commercial_registration', 'tax_card', 'other')),
	CONSTRAINT "party_identity_documents_verification_check" CHECK ("party_identity_documents"."verification_status" IN ('pending', 'verified', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "party_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role_key" varchar(48) NOT NULL,
	"status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	CONSTRAINT "party_roles_key_check" CHECK ("party_roles"."role_key" IN ('prospect', 'tenant', 'owner', 'supplier', 'partner', 'government', 'authorized_representative', 'lawyer', 'other')),
	CONSTRAINT "party_roles_dates_check" CHECK ("party_roles"."ends_on" IS NULL OR "party_roles"."starts_on" IS NULL OR "party_roles"."ends_on" >= "party_roles"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "payment_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"provider" varchar(80) NOT NULL,
	"session_reference" varchar(160) NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"status" "payment_session_status" DEFAULT 'created' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"redirect_url" text,
	"provider_session_id" varchar(200),
	"expires_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_sequences" (
	"organization_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "receipt_sequences_organization_id_year_pk" PRIMARY KEY("organization_id","year")
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"receipt_number" varchar(64) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rendered_pdf_object_key" text,
	"rendered_pdf_hash" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"provider" varchar(80) NOT NULL,
	"provider_reference" varchar(200) NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"reason" varchar(500) NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "representation_authorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"principal_party_id" uuid NOT NULL,
	"representative_party_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	CONSTRAINT "representation_authority_distinct_parties" CHECK ("representation_authorities"."principal_party_id" <> "representation_authorities"."representative_party_id"),
	CONSTRAINT "representation_authority_dates_check" CHECK ("representation_authorities"."ends_on" IS NULL OR "representation_authorities"."starts_on" IS NULL OR "representation_authorities"."ends_on" >= "representation_authorities"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "reference" varchar(64);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "billing_period_start" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "billing_period_end" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "rendered_pdf_object_key" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "rendered_pdf_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "national_id_lookup_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "registration_number_lookup_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "status" "lifecycle_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_schedules" ADD CONSTRAINT "billing_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_schedules" ADD CONSTRAINT "billing_schedules_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_sequences" ADD CONSTRAINT "contract_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_addresses" ADD CONSTRAINT "party_addresses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_addresses" ADD CONSTRAINT "party_addresses_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_addresses" ADD CONSTRAINT "party_addresses_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_identity_documents" ADD CONSTRAINT "party_identity_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_identity_documents" ADD CONSTRAINT "party_identity_documents_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_roles" ADD CONSTRAINT "party_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_roles" ADD CONSTRAINT "party_roles_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sessions" ADD CONSTRAINT "payment_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sessions" ADD CONSTRAINT "payment_sessions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_sequences" ADD CONSTRAINT "receipt_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representation_authorities" ADD CONSTRAINT "representation_authorities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representation_authorities" ADD CONSTRAINT "representation_authorities_principal_party_id_parties_id_fk" FOREIGN KEY ("principal_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representation_authorities" ADD CONSTRAINT "representation_authorities_representative_party_id_parties_id_fk" FOREIGN KEY ("representative_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_schedules_lease_unique" ON "billing_schedules" USING btree ("lease_id");--> statement-breakpoint
CREATE INDEX "billing_schedules_due_idx" ON "billing_schedules" USING btree ("organization_id","status","next_issue_on");--> statement-breakpoint
CREATE INDEX "party_addresses_org_idx" ON "party_addresses" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_identity_document_number_unique" ON "party_identity_documents" USING btree ("organization_id","document_type","number_lookup_hash");--> statement-breakpoint
CREATE INDEX "party_identity_documents_party_idx" ON "party_identity_documents" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "party_identity_documents_expiry_idx" ON "party_identity_documents" USING btree ("organization_id","expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "party_roles_org_party_role_unique" ON "party_roles" USING btree ("organization_id","party_id","role_key");--> statement-breakpoint
CREATE INDEX "party_roles_org_role_idx" ON "party_roles" USING btree ("organization_id","role_key","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_sessions_org_idempotency_unique" ON "payment_sessions" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_sessions_provider_reference_unique" ON "payment_sessions" USING btree ("provider","session_reference");--> statement-breakpoint
CREATE INDEX "payment_sessions_invoice_idx" ON "payment_sessions" USING btree ("invoice_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_payment_unique" ON "receipts" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_org_number_unique" ON "receipts" USING btree ("organization_id","receipt_number");--> statement-breakpoint
CREATE INDEX "receipts_org_idx" ON "receipts" USING btree ("organization_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_reference_unique" ON "refunds" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "representation_authority_unique" ON "representation_authorities" USING btree ("organization_id","principal_party_id","representative_party_id","title");--> statement-breakpoint
CREATE INDEX "representation_authority_representative_idx" ON "representation_authorities" USING btree ("organization_id","representative_party_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_org_reference_unique" ON "contracts" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_lease_period_unique" ON "invoices" USING btree ("organization_id","lease_id","billing_period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "parties_org_national_id_unique" ON "parties" USING btree ("organization_id","national_id_lookup_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "parties_org_registration_unique" ON "parties" USING btree ("organization_id","registration_number_lookup_hash");