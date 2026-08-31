-- Stay housekeeping tasks (turnover after checkout).
CREATE TABLE IF NOT EXISTS "stay_housekeeping_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "organization_id" uuid NOT NULL,
  "booking_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "task_kind" varchar(32) DEFAULT 'turnover' NOT NULL,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "due_on" date NOT NULL,
  "note" text,
  "assigned_to_user_id" uuid,
  "completed_at" timestamptz,
  CONSTRAINT "stay_housekeeping_tasks_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_housekeeping_tasks_booking_id_stay_bookings_id_fk"
    FOREIGN KEY ("booking_id") REFERENCES "public"."stay_bookings"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_housekeeping_tasks_unit_id_units_id_fk"
    FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_housekeeping_tasks_assigned_to_user_id_users_id_fk"
    FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stay_housekeeping_tasks_kind_check"
    CHECK ("task_kind" IN ('turnover', 'inspection', 'deep_clean', 'other')),
  CONSTRAINT "stay_housekeeping_tasks_status_check"
    CHECK ("status" IN ('open', 'in_progress', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stay_housekeeping_tasks_booking_kind_unique"
  ON "stay_housekeeping_tasks" USING btree ("booking_id","task_kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_housekeeping_tasks_org_status_idx"
  ON "stay_housekeeping_tasks" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stay_housekeeping_tasks_unit_due_idx"
  ON "stay_housekeeping_tasks" USING btree ("unit_id","due_on");
