-- Badges, awards, account verification and profile images (0.8.61). Additive only.
--
-- Badges are defined per organization for one subject kind (a property, an owner or tenant party,
-- a staff user or a worker vendor). The evaluator grants an award when a definition's criteria
-- have held for its sustain period, expires it after its validity and revokes it as soon as the
-- criteria stop holding (auto_revoke). Award serials are global so a certificate verifies alone.
--
-- Verification is per account (a person) or per organization (a business), reviewed by the site
-- administration: the legal name must match the account name and the period's fee be settled.

CREATE TABLE IF NOT EXISTS badge_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  serial_no integer NOT NULL,
  code varchar(64) NOT NULL,
  subject_type varchar(16) NOT NULL,
  tier varchar(16) NOT NULL DEFAULT 'badge',
  level varchar(16) NOT NULL DEFAULT 'bronze',
  name_ar varchar(80) NOT NULL,
  name_en varchar(80) NOT NULL,
  description_ar varchar(400),
  description_en varchar(400),
  icon varchar(32) NOT NULL DEFAULT 'star',
  criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  window_days integer NOT NULL DEFAULT 365,
  sustain_days integer NOT NULL DEFAULT 0,
  validity_days integer,
  auto_revoke boolean NOT NULL DEFAULT true,
  grant_mode varchar(16) NOT NULL DEFAULT 'auto',
  status lifecycle_status NOT NULL DEFAULT 'active',
  created_by_user_id uuid REFERENCES users(id),
  CONSTRAINT badge_definitions_subject_check
    CHECK (subject_type IN ('property', 'owner', 'tenant', 'staff', 'worker')),
  CONSTRAINT badge_definitions_tier_check
    CHECK (tier IN ('badge', 'shield', 'certificate', 'medal')),
  CONSTRAINT badge_definitions_level_check
    CHECK (level IN ('bronze', 'silver', 'gold', 'platinum', 'diamond')),
  CONSTRAINT badge_definitions_grant_check CHECK (grant_mode IN ('auto', 'approval', 'manual')),
  CONSTRAINT badge_definitions_criteria_check CHECK (jsonb_typeof(criteria) = 'array'),
  CONSTRAINT badge_definitions_window_check CHECK (window_days BETWEEN 7 AND 3650),
  CONSTRAINT badge_definitions_sustain_check CHECK (sustain_days BETWEEN 0 AND 3650),
  CONSTRAINT badge_definitions_validity_check
    CHECK (validity_days IS NULL OR validity_days BETWEEN 1 AND 3650)
);

CREATE UNIQUE INDEX IF NOT EXISTS badge_definitions_org_serial_unique
  ON badge_definitions (organization_id, serial_no);
CREATE UNIQUE INDEX IF NOT EXISTS badge_definitions_org_code_unique
  ON badge_definitions (organization_id, code);

CREATE TABLE IF NOT EXISTS badge_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  badge_id uuid NOT NULL REFERENCES badge_definitions(id),
  subject_type varchar(16) NOT NULL,
  subject_id uuid NOT NULL,
  serial_year integer NOT NULL,
  serial_no integer NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  awarded_at timestamptz,
  expires_at timestamptz,
  ended_at timestamptz,
  end_reason varchar(400),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale_ar text,
  rationale_en text,
  ai_engine varchar(16) NOT NULL DEFAULT 'rules',
  granted_by_user_id uuid REFERENCES users(id),
  decided_by_user_id uuid REFERENCES users(id),
  CONSTRAINT badge_awards_status_check
    CHECK (status IN ('pending', 'active', 'expired', 'revoked', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS badge_awards_serial_unique
  ON badge_awards (serial_year, serial_no);
CREATE UNIQUE INDEX IF NOT EXISTS badge_awards_live_unique
  ON badge_awards (badge_id, subject_id) WHERE status IN ('pending', 'active');
CREATE INDEX IF NOT EXISTS badge_awards_subject_idx
  ON badge_awards (organization_id, subject_type, subject_id, status);
CREATE INDEX IF NOT EXISTS badge_awards_badge_idx ON badge_awards (badge_id, status);

CREATE TABLE IF NOT EXISTS badge_progress (
  badge_id uuid NOT NULL REFERENCES badge_definitions(id),
  subject_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  qualified_since timestamptz,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (badge_id, subject_id)
);

CREATE INDEX IF NOT EXISTS badge_progress_org_idx ON badge_progress (organization_id);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['badge_definitions', 'badge_awards', 'badge_progress'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_private.is_platform_admin() OR organization_id = app_private.current_organization_id()) WITH CHECK (app_private.is_platform_admin() OR organization_id = app_private.current_organization_id())',
      t || '_isolation',
      t
    );
  END LOOP;
END $$;

-- Ensure the base currency exists before creating verification plans.
-- Migrate runs without seed, so OMR must be present for the FK below.
INSERT INTO currencies (
  code,
  name_ar,
  name_en,
  symbol_ar,
  symbol_en,
  minor_unit,
  active
)
VALUES (
  'OMR',
  'الريال العماني',
  'Omani Rial',
  'ر.ع.',
  'OMR',
  3,
  true
)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS verification_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  kind varchar(16) NOT NULL,
  period varchar(16) NOT NULL,
  price_minor bigint NOT NULL DEFAULT 0,
  currency varchar(3) NOT NULL DEFAULT 'OMR' REFERENCES currencies(code),
  status lifecycle_status NOT NULL DEFAULT 'active',
  updated_by_user_id uuid REFERENCES users(id),
  CONSTRAINT verification_plans_kind_check CHECK (kind IN ('personal', 'business')),
  CONSTRAINT verification_plans_period_check CHECK (period IN ('monthly', 'yearly')),
  CONSTRAINT verification_plans_price_check CHECK (price_minor >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS verification_plans_kind_period_unique
  ON verification_plans (kind, period);

-- Starting fees in baisa (site admin edits them): personal 1 / 10 OMR, business 3 / 30 OMR.
INSERT INTO verification_plans (kind, period, price_minor)
VALUES ('personal', 'monthly', 1000), ('personal', 'yearly', 10000),
  ('business', 'monthly', 3000), ('business', 'yearly', 30000)
ON CONFLICT (kind, period) DO NOTHING;

CREATE TABLE IF NOT EXISTS account_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  serial_year integer NOT NULL,
  serial_no integer NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  organization_id uuid REFERENCES organizations(id),
  kind varchar(16) NOT NULL,
  period varchar(16) NOT NULL,
  fee_minor bigint NOT NULL DEFAULT 0,
  currency varchar(3) NOT NULL DEFAULT 'OMR',
  legal_name_ar varchar(200),
  legal_name_en varchar(200),
  document_type varchar(40) NOT NULL,
  document_last4 varchar(4),
  document_expires_on date,
  name_match_score integer NOT NULL DEFAULT 0,
  status varchar(16) NOT NULL DEFAULT 'submitted',
  payment_status varchar(16) NOT NULL DEFAULT 'unpaid',
  paid_at timestamptz,
  payment_method varchar(32),
  payment_reference varchar(120),
  payment_recorded_by_user_id uuid REFERENCES users(id),
  reviewed_by_user_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_note varchar(500),
  verified_from timestamptz,
  verified_until timestamptz,
  renewal_of uuid REFERENCES account_verifications(id),
  CONSTRAINT account_verifications_kind_check CHECK (kind IN ('personal', 'business')),
  CONSTRAINT account_verifications_period_check CHECK (period IN ('monthly', 'yearly')),
  CONSTRAINT account_verifications_status_check
    CHECK (status IN ('submitted', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT account_verifications_payment_check
    CHECK (payment_status IN ('unpaid', 'paid', 'waived')),
  CONSTRAINT account_verifications_document_check
    CHECK (document_type IN ('civil_id', 'passport', 'residence_card', 'commercial_registration')),
  CONSTRAINT account_verifications_business_check
    CHECK (kind = 'personal' OR organization_id IS NOT NULL),
  CONSTRAINT account_verifications_score_check CHECK (name_match_score BETWEEN 0 AND 100),
  CONSTRAINT account_verifications_fee_check CHECK (fee_minor >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS account_verifications_serial_unique
  ON account_verifications (serial_year, serial_no);
CREATE UNIQUE INDEX IF NOT EXISTS account_verifications_open_unique
  ON account_verifications (user_id, kind, coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'submitted';
CREATE INDEX IF NOT EXISTS account_verifications_user_idx
  ON account_verifications (user_id, status, verified_until);
CREATE INDEX IF NOT EXISTS account_verifications_org_idx
  ON account_verifications (organization_id, status, verified_until)
  WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_verifications_queue_idx
  ON account_verifications (status, created_at);

CREATE TABLE IF NOT EXISTS verification_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  verification_id uuid NOT NULL REFERENCES account_verifications(id) ON DELETE CASCADE,
  slot varchar(16) NOT NULL,
  mime_type varchar(64) NOT NULL,
  data_url text NOT NULL,
  CONSTRAINT verification_documents_slot_check
    CHECK (slot IN ('front', 'back', 'selfie', 'registration'))
);

CREATE UNIQUE INDEX IF NOT EXISTS verification_documents_slot_unique
  ON verification_documents (verification_id, slot);

CREATE TABLE IF NOT EXISTS profile_images (
  subject_type varchar(16) NOT NULL,
  subject_id uuid NOT NULL,
  data_url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id),
  PRIMARY KEY (subject_type, subject_id),
  CONSTRAINT profile_images_subject_check CHECK (subject_type IN ('user', 'organization'))
);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['verification_plans', 'account_verifications', 'verification_documents', 'profile_images'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_private.is_platform_admin()) WITH CHECK (app_private.is_platform_admin())',
      t || '_admin',
      t
    );
  END LOOP;
END $$;
