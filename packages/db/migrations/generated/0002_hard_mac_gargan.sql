CREATE TABLE "property_amenities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"code" varchar(80) NOT NULL,
	"label_ar" varchar(120),
	"label_en" varchar(120)
);
--> statement-breakpoint
CREATE TABLE "property_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"media_asset_id" uuid,
	"document_type" varchar(40) NOT NULL,
	"document_number" varchar(120),
	"issued_on" date,
	"expires_on" date,
	"verification_status" varchar(24) DEFAULT 'pending' NOT NULL,
	"notes" text,
	CONSTRAINT "property_documents_type_check" CHECK ("property_documents"."document_type" IN ('title_deed', 'municipality', 'insurance', 'management_agreement', 'noc', 'floor_plan', 'other')),
	CONSTRAINT "property_documents_verification_check" CHECK ("property_documents"."verification_status" IN ('pending', 'verified', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "property_ownership_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role" varchar(32) DEFAULT 'owner' NOT NULL,
	"share_basis_points" integer DEFAULT 10000 NOT NULL,
	"starts_on" date,
	"ends_on" date,
	CONSTRAINT "property_ownership_share_check" CHECK ("property_ownership_interests"."share_basis_points" > 0 AND "property_ownership_interests"."share_basis_points" <= 10000),
	CONSTRAINT "property_ownership_role_check" CHECK ("property_ownership_interests"."role" IN ('owner', 'usufructuary', 'representative'))
);
--> statement-breakpoint
CREATE TABLE "property_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"deed_number" varchar(120),
	"plot_number" varchar(120),
	"municipality_number" varchar(120),
	"electricity_account_number" varchar(120),
	"water_account_number" varchar(120),
	"land_area_square_meters" varchar(32),
	"built_up_area_square_meters" varchar(32),
	"year_built" integer,
	"floors_count" integer,
	"parking_spaces" integer,
	"furnishing" varchar(24) DEFAULT 'unfurnished' NOT NULL,
	"management_started_on" date,
	"management_fee_minor" bigint,
	"notes" text,
	CONSTRAINT "property_profiles_furnishing_check" CHECK ("property_profiles"."furnishing" IN ('unfurnished', 'semi_furnished', 'furnished')),
	CONSTRAINT "property_profiles_year_built_check" CHECK ("property_profiles"."year_built" IS NULL OR ("property_profiles"."year_built" >= 1800 AND "property_profiles"."year_built" <= 2200)),
	CONSTRAINT "property_profiles_management_fee_nonnegative" CHECK ("property_profiles"."management_fee_minor" IS NULL OR "property_profiles"."management_fee_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "utility_meters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_id" uuid,
	"utility_type" varchar(24) NOT NULL,
	"meter_number" varchar(120) NOT NULL,
	"provider" varchar(160),
	"account_number" varchar(120),
	CONSTRAINT "utility_meters_type_check" CHECK ("utility_meters"."utility_type" IN ('electricity', 'water', 'gas', 'internet', 'cooling', 'other'))
);
--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "sale_price_minor" bigint;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "listing_purpose" varchar(16) DEFAULT 'rent' NOT NULL;--> statement-breakpoint
ALTER TABLE "property_amenities" ADD CONSTRAINT "property_amenities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_amenities" ADD CONSTRAINT "property_amenities_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_ownership_interests" ADD CONSTRAINT "property_ownership_interests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_ownership_interests" ADD CONSTRAINT "property_ownership_interests_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_ownership_interests" ADD CONSTRAINT "property_ownership_interests_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_profiles" ADD CONSTRAINT "property_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_profiles" ADD CONSTRAINT "property_profiles_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_meters" ADD CONSTRAINT "utility_meters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_meters" ADD CONSTRAINT "utility_meters_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_meters" ADD CONSTRAINT "utility_meters_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "property_amenities_property_code_unique" ON "property_amenities" USING btree ("property_id","code");--> statement-breakpoint
CREATE INDEX "property_amenities_org_idx" ON "property_amenities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "property_documents_org_idx" ON "property_documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "property_documents_property_idx" ON "property_documents" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "property_ownership_property_party_unique" ON "property_ownership_interests" USING btree ("property_id","party_id");--> statement-breakpoint
CREATE INDEX "property_ownership_org_idx" ON "property_ownership_interests" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "property_profiles_property_unique" ON "property_profiles" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "property_profiles_org_idx" ON "property_profiles" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "utility_meters_property_number_unique" ON "utility_meters" USING btree ("property_id","utility_type","meter_number");--> statement-breakpoint
CREATE INDEX "utility_meters_org_idx" ON "utility_meters" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_listing_purpose_check" CHECK ("units"."listing_purpose" IN ('rent', 'sale', 'both'));--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_sale_price_nonnegative" CHECK ("units"."sale_price_minor" IS NULL OR "units"."sale_price_minor" >= 0);