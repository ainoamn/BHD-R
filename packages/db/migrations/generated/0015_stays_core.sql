-- BHD R Stays core tables (Phase 1). Additive only — no listingPurpose / holds / leases reuse.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_unit_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "code" varchar(64) NOT NULL,
  "name_ar" varchar(160) NOT NULL,
  "name_en" varchar(160) NOT NULL,
  "max_adults" integer DEFAULT 2 NOT NULL,
  "max_children" integer DEFAULT 0 NOT NULL,
  "max_guests" integer DEFAULT 2 NOT NULL,
  "bedrooms" integer DEFAULT 1 NOT NULL,
  "beds" integer DEFAULT 1 NOT NULL,
  "bathrooms" integer DEFAULT 1 NOT NULL,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  CONSTRAINT "stay_unit_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_unit_types_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_unit_types_status_check" CHECK ("status" IN ('draft', 'active', 'inactive', 'archived')),
  CONSTRAINT "stay_unit_types_capacity_check" CHECK ("max_guests" >= 1 AND "max_adults" >= 0 AND "max_children" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stay_unit_types_org_property_code_unique" ON "stay_unit_types" USING btree ("organization_id","property_id","code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_unit_types_org_idx" ON "stay_unit_types" USING btree ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "kind" varchar(32) NOT NULL,
  "code" varchar(64) NOT NULL,
  "name_ar" varchar(160) NOT NULL,
  "name_en" varchar(160) NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "body_ar" text,
  "body_en" text,
  "rules_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  CONSTRAINT "stay_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_policies_kind_check" CHECK ("kind" IN ('cancellation', 'house_rules', 'check_in', 'other')),
  CONSTRAINT "stay_policies_status_check" CHECK ("status" IN ('draft', 'active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stay_policies_org_kind_code_version_unique" ON "stay_policies" USING btree ("organization_id","kind","code","version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_policies_org_idx" ON "stay_policies" USING btree ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "unit_type_id" uuid NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "publish_status" varchar(24) DEFAULT 'draft' NOT NULL,
  "instant_book" boolean DEFAULT false NOT NULL,
  "timezone" varchar(64) DEFAULT 'Asia/Muscat' NOT NULL,
  "currency" varchar(3) DEFAULT 'OMR' NOT NULL,
  "minor_unit" integer DEFAULT 3 NOT NULL,
  "max_adults" integer DEFAULT 2 NOT NULL,
  "max_children" integer DEFAULT 0 NOT NULL,
  "max_guests" integer DEFAULT 2 NOT NULL,
  "min_nights" integer DEFAULT 1 NOT NULL,
  "max_nights" integer DEFAULT 30 NOT NULL,
  "lead_time_hours" integer DEFAULT 0 NOT NULL,
  "advance_booking_days" integer DEFAULT 365 NOT NULL,
  "check_in_from" varchar(8),
  "check_in_until" varchar(8),
  "check_out_until" varchar(8),
  "cancellation_policy_id" uuid,
  "house_rules_id" uuid,
  CONSTRAINT "stay_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_profiles_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_profiles_unit_type_id_stay_unit_types_id_fk" FOREIGN KEY ("unit_type_id") REFERENCES "public"."stay_unit_types"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_profiles_cancellation_policy_id_stay_policies_id_fk" FOREIGN KEY ("cancellation_policy_id") REFERENCES "public"."stay_policies"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_profiles_house_rules_id_stay_policies_id_fk" FOREIGN KEY ("house_rules_id") REFERENCES "public"."stay_policies"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_profiles_publish_status_check" CHECK ("publish_status" IN ('draft', 'ready', 'published', 'unpublished')),
  CONSTRAINT "stay_profiles_nights_check" CHECK ("min_nights" >= 1 AND "max_nights" >= "min_nights")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stay_profiles_unit_unique" ON "stay_profiles" USING btree ("unit_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_profiles_org_idx" ON "stay_profiles" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_profiles_unit_type_idx" ON "stay_profiles" USING btree ("unit_type_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_public_listings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "unit_type_id" uuid NOT NULL,
  "slug" varchar(180) NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "published_at" timestamp with time zone,
  "title_ar" varchar(200) NOT NULL,
  "title_en" varchar(200) NOT NULL,
  "summary_ar" text,
  "summary_en" text,
  "seo_title_ar" varchar(200),
  "seo_title_en" varchar(200),
  "seo_description_ar" text,
  "seo_description_en" text,
  CONSTRAINT "stay_public_listings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_public_listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_public_listings_unit_type_id_stay_unit_types_id_fk" FOREIGN KEY ("unit_type_id") REFERENCES "public"."stay_unit_types"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stay_public_listings_slug_unique" ON "stay_public_listings" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_public_listings_org_idx" ON "stay_public_listings" USING btree ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_rate_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "stay_profile_id" uuid,
  "unit_type_id" uuid,
  "code" varchar(64) NOT NULL,
  "name_ar" varchar(160) NOT NULL,
  "name_en" varchar(160) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "base_nightly_minor" bigint NOT NULL,
  "weekend_nightly_minor" bigint,
  "refundable" boolean DEFAULT true NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "priority" integer DEFAULT 100 NOT NULL,
  CONSTRAINT "stay_rate_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_rate_plans_stay_profile_id_stay_profiles_id_fk" FOREIGN KEY ("stay_profile_id") REFERENCES "public"."stay_profiles"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_rate_plans_unit_type_id_stay_unit_types_id_fk" FOREIGN KEY ("unit_type_id") REFERENCES "public"."stay_unit_types"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_rate_plans_base_positive" CHECK ("base_nightly_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_rate_plans_org_idx" ON "stay_rate_plans" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_rate_plans_profile_idx" ON "stay_rate_plans" USING btree ("stay_profile_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_rate_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "rate_plan_id" uuid NOT NULL,
  "starts_on" date NOT NULL,
  "ends_on" date NOT NULL,
  "days_of_week" integer[] DEFAULT ARRAY[0,1,2,3,4,5,6]::integer[] NOT NULL,
  "adjustment_type" varchar(24) NOT NULL,
  "adjustment_minor" bigint,
  "adjustment_bps" integer,
  "min_nights" integer,
  "priority" integer DEFAULT 100 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  CONSTRAINT "stay_rate_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_rate_rules_rate_plan_id_stay_rate_plans_id_fk" FOREIGN KEY ("rate_plan_id") REFERENCES "public"."stay_rate_plans"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_rate_rules_adjustment_type_check" CHECK ("adjustment_type" IN ('absolute', 'relative_bps')),
  CONSTRAINT "stay_rate_rules_range_check" CHECK ("ends_on" >= "starts_on")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_rate_rules_org_idx" ON "stay_rate_rules" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_rate_rules_plan_range_idx" ON "stay_rate_rules" USING btree ("rate_plan_id","starts_on","ends_on");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_fees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "stay_profile_id" uuid,
  "unit_type_id" uuid,
  "code" varchar(64) NOT NULL,
  "name_ar" varchar(160) NOT NULL,
  "name_en" varchar(160) NOT NULL,
  "fee_kind" varchar(32) NOT NULL,
  "calculation_type" varchar(32) NOT NULL,
  "amount_minor" bigint,
  "percent_bps" integer,
  "currency" varchar(3) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  CONSTRAINT "stay_fees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_fees_stay_profile_id_stay_profiles_id_fk" FOREIGN KEY ("stay_profile_id") REFERENCES "public"."stay_profiles"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_fees_unit_type_id_stay_unit_types_id_fk" FOREIGN KEY ("unit_type_id") REFERENCES "public"."stay_unit_types"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_fees_kind_check" CHECK ("fee_kind" IN ('cleaning', 'service', 'extra_guest', 'deposit', 'local_tax', 'other')),
  CONSTRAINT "stay_fees_calculation_type_check" CHECK ("calculation_type" IN ('fixed', 'per_night', 'per_guest', 'percent'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_fees_org_idx" ON "stay_fees" USING btree ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_inventory_locks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "stay_range" daterange NOT NULL,
  "kind" varchar(24) NOT NULL,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "source_type" varchar(64),
  "source_id" uuid,
  "expires_at" timestamp with time zone,
  "note" text,
  "created_by_user_id" uuid,
  CONSTRAINT "stay_inventory_locks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_inventory_locks_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_inventory_locks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_inventory_locks_kind_check" CHECK ("kind" IN ('hold', 'booking', 'owner_block', 'maintenance', 'lease', 'channel')),
  CONSTRAINT "stay_inventory_locks_status_check" CHECK ("status" IN ('active', 'released')),
  CONSTRAINT "stay_inventory_locks_range_bounds_check" CHECK (lower_inc("stay_range") AND NOT upper_inc("stay_range") AND NOT isempty("stay_range")),
  CONSTRAINT "stay_inventory_locks_no_overlap_active" EXCLUDE USING gist ("unit_id" WITH =, "stay_range" WITH &&) WHERE ("status" = 'active')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_inventory_locks_org_idx" ON "stay_inventory_locks" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_inventory_locks_unit_status_idx" ON "stay_inventory_locks" USING btree ("unit_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_inventory_locks_expires_idx" ON "stay_inventory_locks" USING btree ("expires_at") WHERE "status" = 'active' AND "kind" = 'hold';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_inventory_days" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "stay_date" date NOT NULL,
  "availability_status" varchar(24) DEFAULT 'available' NOT NULL,
  "effective_rate_minor" bigint,
  "currency" varchar(3),
  "min_nights" integer,
  CONSTRAINT "stay_inventory_days_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_inventory_days_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_inventory_days_status_check" CHECK ("availability_status" IN ('available', 'blocked', 'booked', 'hold', 'maintenance', 'lease'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stay_inventory_days_unit_date_unique" ON "stay_inventory_days" USING btree ("unit_id","stay_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_inventory_days_org_idx" ON "stay_inventory_days" USING btree ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "stay_profile_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "check_in_on" date NOT NULL,
  "check_out_on" date NOT NULL,
  "nights" integer NOT NULL,
  "adults" integer DEFAULT 1 NOT NULL,
  "children" integer DEFAULT 0 NOT NULL,
  "currency" varchar(3) NOT NULL,
  "minor_unit" integer NOT NULL,
  "subtotal_minor" bigint NOT NULL,
  "fees_minor" bigint DEFAULT 0 NOT NULL,
  "tax_minor" bigint DEFAULT 0 NOT NULL,
  "total_minor" bigint NOT NULL,
  "line_items_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "fees_snapshot_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "payload_hash" varchar(128) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "stay_quotes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_quotes_stay_profile_id_stay_profiles_id_fk" FOREIGN KEY ("stay_profile_id") REFERENCES "public"."stay_profiles"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_quotes_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_quotes_dates_check" CHECK ("check_out_on" > "check_in_on" AND "nights" >= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_quotes_org_idx" ON "stay_quotes" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_quotes_expires_idx" ON "stay_quotes" USING btree ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_holds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "quote_id" uuid NOT NULL,
  "inventory_lock_id" uuid NOT NULL,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "idempotency_key" varchar(128),
  CONSTRAINT "stay_holds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_holds_quote_id_stay_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."stay_quotes"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_holds_inventory_lock_id_stay_inventory_locks_id_fk" FOREIGN KEY ("inventory_lock_id") REFERENCES "public"."stay_inventory_locks"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_holds_status_check" CHECK ("status" IN ('active', 'converted', 'expired', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_holds_org_idx" ON "stay_holds" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_holds_status_expires_idx" ON "stay_holds" USING btree ("status","expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stay_holds_org_idempotency_unique" ON "stay_holds" USING btree ("organization_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_bookings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "unit_type_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "stay_profile_id" uuid NOT NULL,
  "reference_code" varchar(32) NOT NULL,
  "guest_party_id" uuid,
  "user_id" uuid,
  "check_in_on" date NOT NULL,
  "check_out_on" date NOT NULL,
  "timezone" varchar(64) DEFAULT 'Asia/Muscat' NOT NULL,
  "status" varchar(32) NOT NULL,
  "booking_mode" varchar(24) NOT NULL,
  "source" varchar(24) DEFAULT 'direct' NOT NULL,
  "quote_id" uuid,
  "hold_id" uuid,
  "inventory_lock_id" uuid NOT NULL,
  "currency" varchar(3) NOT NULL,
  "minor_unit" integer NOT NULL,
  "subtotal_minor" bigint NOT NULL,
  "fees_minor" bigint DEFAULT 0 NOT NULL,
  "tax_minor" bigint DEFAULT 0 NOT NULL,
  "total_minor" bigint NOT NULL,
  "pricing_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "policy_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "country_pack_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "stay_bookings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_bookings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_bookings_unit_type_id_stay_unit_types_id_fk" FOREIGN KEY ("unit_type_id") REFERENCES "public"."stay_unit_types"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_bookings_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_bookings_stay_profile_id_stay_profiles_id_fk" FOREIGN KEY ("stay_profile_id") REFERENCES "public"."stay_profiles"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_bookings_guest_party_id_parties_id_fk" FOREIGN KEY ("guest_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_bookings_quote_id_stay_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."stay_quotes"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_bookings_hold_id_stay_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."stay_holds"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_bookings_inventory_lock_id_stay_inventory_locks_id_fk" FOREIGN KEY ("inventory_lock_id") REFERENCES "public"."stay_inventory_locks"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_bookings_status_check" CHECK ("status" IN (
    'request_pending', 'payment_pending', 'confirmed', 'pre_arrival',
    'checked_in', 'checked_out', 'closed', 'cancelled', 'expired', 'payment_failed', 'no_show'
  )),
  CONSTRAINT "stay_bookings_mode_check" CHECK ("booking_mode" IN ('instant', 'request')),
  CONSTRAINT "stay_bookings_source_check" CHECK ("source" IN ('direct', 'admin', 'channel')),
  CONSTRAINT "stay_bookings_dates_check" CHECK ("check_out_on" > "check_in_on")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stay_bookings_org_reference_unique" ON "stay_bookings" USING btree ("organization_id","reference_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_bookings_org_status_idx" ON "stay_bookings" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_bookings_unit_dates_idx" ON "stay_bookings" USING btree ("unit_id","check_in_on","check_out_on");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_booking_guests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "booking_id" uuid NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "display_name" varchar(160) NOT NULL,
  "email_encrypted" text,
  "phone_encrypted" text,
  "encryption_key_version" varchar(16),
  "guest_type" varchar(24) DEFAULT 'adult' NOT NULL,
  CONSTRAINT "stay_booking_guests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_booking_guests_booking_id_stay_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."stay_bookings"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_booking_guests_type_check" CHECK ("guest_type" IN ('adult', 'child', 'infant'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_booking_guests_org_idx" ON "stay_booking_guests" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_booking_guests_booking_idx" ON "stay_booking_guests" USING btree ("booking_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_booking_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "booking_id" uuid NOT NULL,
  "from_status" varchar(32),
  "to_status" varchar(32) NOT NULL,
  "actor_user_id" uuid,
  "reason" text,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "stay_booking_status_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_booking_status_history_booking_id_stay_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."stay_bookings"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_booking_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_booking_status_history_org_idx" ON "stay_booking_status_history" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_booking_status_history_booking_idx" ON "stay_booking_status_history" USING btree ("booking_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_folios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "booking_id" uuid NOT NULL,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "currency" varchar(3) NOT NULL,
  "balance_minor" bigint DEFAULT 0 NOT NULL,
  CONSTRAINT "stay_folios_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_folios_booking_id_stay_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."stay_bookings"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_folios_status_check" CHECK ("status" IN ('open', 'closed', 'void'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_folios_org_idx" ON "stay_folios" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_folios_booking_idx" ON "stay_folios" USING btree ("booking_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_charges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "folio_id" uuid NOT NULL,
  "charge_kind" varchar(32) NOT NULL,
  "description" varchar(240) NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" varchar(3) NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "stay_date" date,
  CONSTRAINT "stay_charges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_charges_folio_id_stay_folios_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."stay_folios"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_charges_kind_check" CHECK ("charge_kind" IN ('night', 'cleaning', 'service', 'tax', 'deposit', 'adjustment', 'other'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_charges_org_idx" ON "stay_charges" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_charges_folio_idx" ON "stay_charges" USING btree ("folio_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_payment_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "booking_id" uuid NOT NULL,
  "folio_id" uuid,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" varchar(3) NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "provider" varchar(64),
  "provider_intent_id" varchar(128),
  "provider_event_id" varchar(128),
  CONSTRAINT "stay_payment_intents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_payment_intents_booking_id_stay_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."stay_bookings"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_payment_intents_folio_id_stay_folios_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."stay_folios"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_payment_intents_status_check" CHECK ("status" IN ('pending', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT "stay_payment_intents_amount_positive" CHECK ("amount_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stay_payment_intents_org_idempotency_unique" ON "stay_payment_intents" USING btree ("organization_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stay_payment_intents_provider_event_unique" ON "stay_payment_intents" USING btree ("provider","provider_event_id") WHERE "provider_event_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_payment_intents_org_idx" ON "stay_payment_intents" USING btree ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_payment_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "payment_intent_id" uuid NOT NULL,
  "folio_id" uuid NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" varchar(3) NOT NULL,
  CONSTRAINT "stay_payment_allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_payment_allocations_payment_intent_id_stay_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."stay_payment_intents"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_payment_allocations_folio_id_stay_folios_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."stay_folios"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_payment_allocations_amount_positive" CHECK ("amount_minor" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_payment_allocations_org_idx" ON "stay_payment_allocations" USING btree ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "booking_id" uuid NOT NULL,
  "payment_intent_id" uuid,
  "status" varchar(24) DEFAULT 'requested' NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" varchar(3) NOT NULL,
  "reason" text,
  "requested_by_user_id" uuid,
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "executed_at" timestamp with time zone,
  "idempotency_key" varchar(128),
  CONSTRAINT "stay_refunds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_refunds_booking_id_stay_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."stay_bookings"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_refunds_payment_intent_id_stay_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."stay_payment_intents"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_refunds_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_refunds_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_refunds_status_check" CHECK ("status" IN ('requested', 'approved', 'rejected', 'executed', 'failed')),
  CONSTRAINT "stay_refunds_amount_positive" CHECK ("amount_minor" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_refunds_org_idx" ON "stay_refunds" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_refunds_booking_idx" ON "stay_refunds" USING btree ("booking_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stay_refunds_org_idempotency_unique" ON "stay_refunds" USING btree ("organization_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stay_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "booking_id" uuid NOT NULL,
  "author_user_id" uuid NOT NULL,
  "rating" integer NOT NULL,
  "body" text,
  "status" varchar(24) DEFAULT 'published' NOT NULL,
  "moderated_by_user_id" uuid,
  "moderated_at" timestamp with time zone,
  CONSTRAINT "stay_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_reviews_booking_id_stay_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."stay_bookings"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_reviews_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_reviews_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_reviews_rating_check" CHECK ("rating" >= 1 AND "rating" <= 5),
  CONSTRAINT "stay_reviews_status_check" CHECK ("status" IN ('published', 'hidden', 'pending_moderation'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stay_reviews_booking_unique" ON "stay_reviews" USING btree ("booking_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_reviews_org_idx" ON "stay_reviews" USING btree ("organization_id");
