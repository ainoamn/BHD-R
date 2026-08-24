ALTER TABLE "contracts" ADD COLUMN "kind" varchar(24) DEFAULT 'initial' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "parent_contract_id" uuid;--> statement-breakpoint
CREATE INDEX "contracts_parent_idx" ON "contracts" USING btree ("parent_contract_id");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_kind_check" CHECK ("contracts"."kind" IN ('initial', 'renewal', 'amendment', 'termination'));