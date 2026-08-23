CREATE TYPE "public"."journal_status" AS ENUM('draft', 'posted', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."ledger_account_type" AS ENUM('asset', 'liability', 'equity', 'revenue', 'expense');--> statement-breakpoint
CREATE TYPE "public"."legal_case_status" AS ENUM('assessment', 'notice', 'filed', 'hearing', 'judgment', 'enforcement', 'settled', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sales_deal_status" AS ENUM('lead', 'qualified', 'viewing', 'offer', 'negotiation', 'reserved', 'contracting', 'closed_won', 'closed_lost', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."viewing_status" AS ENUM('requested', 'scheduled', 'completed', 'no_show', 'cancelled', 'converted');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('draft', 'quoted', 'awaiting_approval', 'approved', 'scheduled', 'in_progress', 'completed', 'verified', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('draft', 'pending', 'approved', 'in_progress', 'on_hold', 'completed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" varchar(64) NOT NULL,
	"type" varchar(80) NOT NULL,
	"subject" varchar(240) NOT NULL,
	"resource_type" varchar(80) NOT NULL,
	"resource_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"assigned_to_user_id" uuid,
	"status" "workflow_status" DEFAULT 'pending' NOT NULL,
	"decision_note" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" varchar(64) NOT NULL,
	"property_id" uuid,
	"unit_id" uuid,
	"vendor_id" uuid,
	"work_order_id" uuid,
	"category" varchar(80) NOT NULL,
	"description" varchar(500) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"currency" varchar(3) NOT NULL,
	"minor_unit" integer NOT NULL,
	"status" "workflow_status" DEFAULT 'pending' NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date,
	"paid_at" timestamp with time zone,
	"notes" text,
	CONSTRAINT "expenses_amounts_nonnegative" CHECK ("expenses"."amount_minor" >= 0 and "expenses"."tax_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" varchar(64) NOT NULL,
	"occurred_on" date NOT NULL,
	"description" varchar(500) NOT NULL,
	"status" "journal_status" DEFAULT 'draft' NOT NULL,
	"source_type" varchar(60),
	"source_id" uuid,
	"posted_by_user_id" uuid,
	"posted_at" timestamp with time zone,
	"reversal_of_id" uuid
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"party_id" uuid,
	"property_id" uuid,
	"unit_id" uuid,
	"debit_minor" bigint DEFAULT 0 NOT NULL,
	"credit_minor" bigint DEFAULT 0 NOT NULL,
	"currency" varchar(3) NOT NULL,
	"minor_unit" integer NOT NULL,
	"memo" varchar(500),
	CONSTRAINT "journal_lines_one_side_check" CHECK (("journal_lines"."debit_minor" > 0 and "journal_lines"."credit_minor" = 0) or ("journal_lines"."credit_minor" > 0 and "journal_lines"."debit_minor" = 0))
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"parent_id" uuid,
	"code" varchar(40) NOT NULL,
	"name_ar" varchar(160) NOT NULL,
	"name_en" varchar(160) NOT NULL,
	"type" "ledger_account_type" NOT NULL,
	"currency" varchar(3),
	"active" boolean DEFAULT true NOT NULL,
	"system" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" varchar(64) NOT NULL,
	"case_number" varchar(120),
	"case_type" varchar(80) NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text,
	"property_id" uuid,
	"unit_id" uuid,
	"lease_id" uuid,
	"counterparty_id" uuid,
	"lawyer_party_id" uuid,
	"assigned_to_user_id" uuid,
	"court" varchar(200),
	"status" "legal_case_status" DEFAULT 'assessment' NOT NULL,
	"claim_amount_minor" bigint DEFAULT 0 NOT NULL,
	"recovered_amount_minor" bigint DEFAULT 0 NOT NULL,
	"currency" varchar(3) NOT NULL,
	"minor_unit" integer NOT NULL,
	"opened_on" date NOT NULL,
	"next_hearing_at" timestamp with time zone,
	"closed_on" date,
	CONSTRAINT "legal_cases_amounts_nonnegative" CHECK ("legal_cases"."claim_amount_minor" >= 0 and "legal_cases"."recovered_amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "legal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_case_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"type" varchar(60) NOT NULL,
	"title" varchar(200) NOT NULL,
	"notes" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "maintenance_work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"vendor_id" uuid,
	"assigned_to_user_id" uuid,
	"reference" varchar(64) NOT NULL,
	"status" "work_order_status" DEFAULT 'draft' NOT NULL,
	"scope" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"estimate_minor" bigint DEFAULT 0 NOT NULL,
	"approved_minor" bigint DEFAULT 0 NOT NULL,
	"actual_minor" bigint DEFAULT 0 NOT NULL,
	"currency" varchar(3) NOT NULL,
	"minor_unit" integer NOT NULL,
	"completion_notes" text,
	"completed_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	CONSTRAINT "maintenance_work_orders_amounts_nonnegative" CHECK ("maintenance_work_orders"."estimate_minor" >= 0 and "maintenance_work_orders"."approved_minor" >= 0 and "maintenance_work_orders"."actual_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "operational_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" varchar(64) NOT NULL,
	"type" varchar(60) NOT NULL,
	"requester_party_id" uuid,
	"property_id" uuid,
	"unit_id" uuid,
	"assigned_to_user_id" uuid,
	"subject" varchar(200) NOT NULL,
	"description" text,
	"priority" "maintenance_priority" DEFAULT 'normal' NOT NULL,
	"status" "workflow_status" DEFAULT 'pending' NOT NULL,
	"source" varchar(40) DEFAULT 'portal' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" varchar(64) NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_id" uuid,
	"seller_party_id" uuid NOT NULL,
	"buyer_party_id" uuid,
	"assigned_to_user_id" uuid,
	"status" "sales_deal_status" DEFAULT 'lead' NOT NULL,
	"asking_price_minor" bigint NOT NULL,
	"offer_price_minor" bigint,
	"agreed_price_minor" bigint,
	"commission_minor" bigint DEFAULT 0 NOT NULL,
	"currency" varchar(3) NOT NULL,
	"minor_unit" integer NOT NULL,
	"expected_closing_on" date,
	"closed_on" date,
	"notes" text,
	CONSTRAINT "sales_deals_prices_nonnegative" CHECK ("sales_deals"."asking_price_minor" >= 0 and "sales_deals"."commission_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"party_id" uuid,
	"code" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"category" varchar(80) NOT NULL,
	"phone" varchar(40),
	"email" varchar(320),
	"tax_registration_number_encrypted" text,
	"rating_basis_points" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "vendors_rating_check" CHECK ("vendors"."rating_basis_points" between 0 and 500)
);
--> statement-breakpoint
CREATE TABLE "viewing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" varchar(64) NOT NULL,
	"unit_id" uuid NOT NULL,
	"prospect_party_id" uuid NOT NULL,
	"assigned_to_user_id" uuid,
	"channel" varchar(40) DEFAULT 'website' NOT NULL,
	"status" "viewing_status" DEFAULT 'requested' NOT NULL,
	"preferred_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "work_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" varchar(64) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"category" varchar(60) NOT NULL,
	"status" "workflow_status" DEFAULT 'pending' NOT NULL,
	"priority" "maintenance_priority" DEFAULT 'normal' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"assigned_to_user_id" uuid,
	"property_id" uuid,
	"unit_id" uuid,
	"related_type" varchar(60),
	"related_id" uuid,
	"starts_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"resource_type" varchar(80) NOT NULL,
	"resource_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"from_status" varchar(60),
	"to_status" varchar(60),
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_work_order_id_maintenance_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."maintenance_work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_cases" ADD CONSTRAINT "legal_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_cases" ADD CONSTRAINT "legal_cases_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_cases" ADD CONSTRAINT "legal_cases_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_cases" ADD CONSTRAINT "legal_cases_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_cases" ADD CONSTRAINT "legal_cases_counterparty_id_parties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_cases" ADD CONSTRAINT "legal_cases_lawyer_party_id_parties_id_fk" FOREIGN KEY ("lawyer_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_cases" ADD CONSTRAINT "legal_cases_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_events" ADD CONSTRAINT "legal_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_events" ADD CONSTRAINT "legal_events_legal_case_id_legal_cases_id_fk" FOREIGN KEY ("legal_case_id") REFERENCES "public"."legal_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_events" ADD CONSTRAINT "legal_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_ticket_id_maintenance_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."maintenance_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_requests" ADD CONSTRAINT "operational_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_requests" ADD CONSTRAINT "operational_requests_requester_party_id_parties_id_fk" FOREIGN KEY ("requester_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_requests" ADD CONSTRAINT "operational_requests_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_requests" ADD CONSTRAINT "operational_requests_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_requests" ADD CONSTRAINT "operational_requests_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_deals" ADD CONSTRAINT "sales_deals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_deals" ADD CONSTRAINT "sales_deals_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_deals" ADD CONSTRAINT "sales_deals_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_deals" ADD CONSTRAINT "sales_deals_seller_party_id_parties_id_fk" FOREIGN KEY ("seller_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_deals" ADD CONSTRAINT "sales_deals_buyer_party_id_parties_id_fk" FOREIGN KEY ("buyer_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_deals" ADD CONSTRAINT "sales_deals_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_prospect_party_id_parties_id_fk" FOREIGN KEY ("prospect_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_org_reference_unique" ON "approval_requests" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "approval_requests_org_status_idx" ON "approval_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_org_reference_unique" ON "expenses" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "expenses_org_status_idx" ON "expenses" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_org_reference_unique" ON "journal_entries" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "journal_entries_org_date_idx" ON "journal_entries" USING btree ("organization_id","occurred_on");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_org_code_unique" ON "ledger_accounts" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "ledger_accounts_org_type_idx" ON "ledger_accounts" USING btree ("organization_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_cases_org_reference_unique" ON "legal_cases" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "legal_cases_org_status_idx" ON "legal_cases" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "legal_cases_next_hearing_idx" ON "legal_cases" USING btree ("next_hearing_at");--> statement-breakpoint
CREATE INDEX "legal_events_case_time_idx" ON "legal_events" USING btree ("legal_case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "legal_events_org_deadline_idx" ON "legal_events" USING btree ("organization_id","deadline_at");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_work_orders_org_reference_unique" ON "maintenance_work_orders" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "maintenance_work_orders_ticket_idx" ON "maintenance_work_orders" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "maintenance_work_orders_org_status_idx" ON "maintenance_work_orders" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_requests_org_reference_unique" ON "operational_requests" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "operational_requests_org_status_idx" ON "operational_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "operational_requests_unit_idx" ON "operational_requests" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_deals_org_reference_unique" ON "sales_deals" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "sales_deals_org_status_idx" ON "sales_deals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_org_code_unique" ON "vendors" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "vendors_org_category_idx" ON "vendors" USING btree ("organization_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "viewing_requests_org_reference_unique" ON "viewing_requests" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "viewing_requests_org_status_idx" ON "viewing_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "viewing_requests_unit_idx" ON "viewing_requests" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_tasks_org_reference_unique" ON "work_tasks" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "work_tasks_org_status_idx" ON "work_tasks" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "work_tasks_assignee_due_idx" ON "work_tasks" USING btree ("assigned_to_user_id","due_at");--> statement-breakpoint
CREATE INDEX "workflow_events_resource_time_idx" ON "workflow_events" USING btree ("organization_id","resource_type","resource_id","occurred_at");