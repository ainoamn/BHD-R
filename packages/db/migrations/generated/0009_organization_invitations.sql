CREATE TABLE IF NOT EXISTS "organization_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "email" varchar(320) NOT NULL,
  "role_key" varchar(80) DEFAULT 'organization_admin' NOT NULL,
  "principal_party_id" uuid,
  "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "token_digest" varchar(128) NOT NULL,
  "invited_by_user_id" uuid NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "revoked_at" timestamptz
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_principal_party_id_parties_id_fk" FOREIGN KEY ("principal_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_invitations_token_unique" ON "organization_invitations" USING btree ("token_digest");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_invitations_org_email_idx" ON "organization_invitations" USING btree ("organization_id","email");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_open_check" CHECK ("accepted_at" IS NULL OR "revoked_at" IS NULL);
EXCEPTION WHEN duplicate_object THEN null; END $$;
