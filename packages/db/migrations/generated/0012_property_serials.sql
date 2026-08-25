ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "serial_number" varchar(40);
CREATE UNIQUE INDEX IF NOT EXISTS "properties_org_serial_unique"
  ON "properties" ("organization_id", "serial_number");

CREATE TABLE IF NOT EXISTS "property_sequences" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "year" integer NOT NULL,
  "type_code" varchar(16) NOT NULL,
  "next_value" bigint NOT NULL DEFAULT 1,
  PRIMARY KEY ("organization_id", "year", "type_code")
);
