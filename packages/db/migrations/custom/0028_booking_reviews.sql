-- Two-sided stay reviews (0.8.17): the guest rates the property and its management, the
-- host rates the guest. Both are required before the deposit refund moves on. Additive only.

CREATE TABLE IF NOT EXISTS booking_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  booking_id uuid NOT NULL REFERENCES stay_bookings(id),
  property_id uuid NOT NULL REFERENCES properties(id),
  unit_id uuid REFERENCES units(id),
  direction varchar(16) NOT NULL,
  author_user_id uuid REFERENCES users(id),
  author_name varchar(160),
  subject_user_id uuid REFERENCES users(id),
  subject_email_hash varchar(32),
  subject_name varchar(160),
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  criteria_score numeric(4, 2) NOT NULL,
  ai_text_score numeric(4, 2),
  score numeric(4, 2) NOT NULL,
  property_score numeric(4, 2),
  host_score numeric(4, 2),
  recommend boolean,
  comment text,
  ai_summary_ar text,
  ai_summary_en text,
  ai_highlights jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_concerns jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_engine varchar(16) NOT NULL DEFAULT 'rules',
  photo_count integer NOT NULL DEFAULT 0,
  status varchar(16) NOT NULL DEFAULT 'published',
  CONSTRAINT booking_reviews_direction_check
    CHECK (direction IN ('guest_to_host', 'host_to_guest')),
  CONSTRAINT booking_reviews_status_check CHECK (status IN ('published', 'hidden')),
  CONSTRAINT booking_reviews_score_check
    CHECK (score BETWEEN 0 AND 10 AND criteria_score BETWEEN 0 AND 10)
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_reviews_booking_direction_unique
  ON booking_reviews (booking_id, direction);
CREATE INDEX IF NOT EXISTS booking_reviews_property_idx
  ON booking_reviews (property_id, direction, created_at);
CREATE INDEX IF NOT EXISTS booking_reviews_org_idx
  ON booking_reviews (organization_id, direction, created_at);
CREATE INDEX IF NOT EXISTS booking_reviews_subject_user_idx
  ON booking_reviews (subject_user_id) WHERE subject_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS booking_reviews_subject_email_idx
  ON booking_reviews (subject_email_hash) WHERE subject_email_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS booking_review_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  review_id uuid NOT NULL REFERENCES booking_reviews(id) ON DELETE CASCADE,
  position integer NOT NULL,
  data_url text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_review_photos_review_position_unique
  ON booking_review_photos (review_id, position);

CREATE TABLE IF NOT EXISTS review_profiles (
  subject_type varchar(16) NOT NULL,
  subject_key varchar(64) NOT NULL,
  review_count integer NOT NULL DEFAULT 0,
  summary_ar text,
  summary_en text,
  strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  watchouts jsonb NOT NULL DEFAULT '[]'::jsonb,
  engine varchar(16) NOT NULL DEFAULT 'rules',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_type, subject_key),
  CONSTRAINT review_profiles_subject_type_check CHECK (subject_type IN ('property', 'host', 'guest'))
);

ALTER TABLE booking_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_reviews_isolation ON booking_reviews;
CREATE POLICY booking_reviews_isolation ON booking_reviews
USING (
  app_private.is_platform_admin()
  OR (app_private.is_public() AND status = 'published')
  OR organization_id = app_private.current_organization_id()
)
WITH CHECK (
  app_private.is_platform_admin()
  OR organization_id = app_private.current_organization_id()
);

ALTER TABLE booking_review_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_review_photos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_review_photos_isolation ON booking_review_photos;
CREATE POLICY booking_review_photos_isolation ON booking_review_photos
USING (
  app_private.is_platform_admin()
  OR app_private.is_public()
  OR organization_id = app_private.current_organization_id()
)
WITH CHECK (
  app_private.is_platform_admin()
  OR organization_id = app_private.current_organization_id()
);

ALTER TABLE review_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_profiles_read ON review_profiles;
CREATE POLICY review_profiles_read ON review_profiles
USING (true)
WITH CHECK (app_private.is_platform_admin());

-- Live sync: a new review refreshes the booking's portals (resource = booking_id).
DO $$
BEGIN
  IF to_regprocedure('live_changes_capture()') IS NOT NULL THEN
    CREATE OR REPLACE TRIGGER live_changes_ins AFTER INSERT ON booking_reviews
      REFERENCING NEW TABLE AS new_rows
      FOR EACH STATEMENT EXECUTE FUNCTION live_changes_capture('booking_id');
    CREATE OR REPLACE TRIGGER live_changes_upd AFTER UPDATE ON booking_reviews
      REFERENCING NEW TABLE AS new_rows
      FOR EACH STATEMENT EXECUTE FUNCTION live_changes_capture('booking_id');
  END IF;
END;
$$;
