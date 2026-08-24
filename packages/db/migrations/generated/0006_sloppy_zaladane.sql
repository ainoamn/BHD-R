CREATE TABLE "reservation_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"requirement_id" uuid,
	"media_asset_id" uuid NOT NULL,
	"document_type" varchar(80) NOT NULL,
	"status" varchar(24) DEFAULT 'submitted' NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"reviewed_by_user_id" uuid,
	"review_notes" text,
	"reviewed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "reservation_documents_status_check" CHECK ("reservation_documents"."status" IN ('submitted', 'approved', 'rejected', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "reservation_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"code" varchar(80) NOT NULL,
	"label_ar" varchar(200) NOT NULL,
	"label_en" varchar(200) NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"due_at" timestamp with time zone,
	"notes" text,
	CONSTRAINT "reservation_requirements_status_check" CHECK ("reservation_requirements"."status" IN ('pending', 'submitted', 'approved', 'rejected', 'waived'))
);
--> statement-breakpoint
ALTER TABLE "reservation_documents" ADD CONSTRAINT "reservation_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_documents" ADD CONSTRAINT "reservation_documents_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_documents" ADD CONSTRAINT "reservation_documents_requirement_id_reservation_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."reservation_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_documents" ADD CONSTRAINT "reservation_documents_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_documents" ADD CONSTRAINT "reservation_documents_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_documents" ADD CONSTRAINT "reservation_documents_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_requirements" ADD CONSTRAINT "reservation_requirements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_requirements" ADD CONSTRAINT "reservation_requirements_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_documents_media_unique" ON "reservation_documents" USING btree ("media_asset_id");--> statement-breakpoint
CREATE INDEX "reservation_documents_reservation_idx" ON "reservation_documents" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "reservation_documents_org_idx" ON "reservation_documents" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_requirements_code_unique" ON "reservation_requirements" USING btree ("reservation_id","code");--> statement-breakpoint
CREATE INDEX "reservation_requirements_org_idx" ON "reservation_requirements" USING btree ("organization_id");