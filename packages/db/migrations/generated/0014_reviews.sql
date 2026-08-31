DO $$ BEGIN
  CREATE TYPE "public"."review_target_type" AS ENUM('property', 'party', 'organization');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."review_status" AS ENUM('published', 'hidden');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "author_user_id" uuid NOT NULL,
  "author_party_id" uuid,
  "target_type" "review_target_type" NOT NULL,
  "target_id" uuid NOT NULL,
  "rating" integer NOT NULL,
  "body" text,
  "verified_stay" boolean DEFAULT false NOT NULL,
  "verified_role" varchar(32),
  "status" "review_status" DEFAULT 'published' NOT NULL,
  CONSTRAINT "reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "reviews_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "reviews_author_party_id_parties_id_fk" FOREIGN KEY ("author_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "reviews_rating_check" CHECK ("rating" >= 1 AND "rating" <= 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reviews_author_target_unique" ON "reviews" USING btree ("author_user_id","target_type","target_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_target_idx" ON "reviews" USING btree ("target_type","target_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_org_idx" ON "reviews" USING btree ("organization_id");
