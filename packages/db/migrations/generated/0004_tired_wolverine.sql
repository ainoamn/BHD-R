CREATE TABLE "journal_sequences" (
	"organization_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"kind" varchar(12) DEFAULT 'JRN' NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "journal_sequences_organization_id_year_kind_pk" PRIMARY KEY("organization_id","year","kind")
);
--> statement-breakpoint
ALTER TABLE "journal_sequences" ADD CONSTRAINT "journal_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_org_source_unique" ON "journal_entries" USING btree ("organization_id","source_type","source_id");