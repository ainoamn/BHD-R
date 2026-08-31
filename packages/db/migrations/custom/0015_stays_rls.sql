-- RLS for BHD R Stays tables (tenant isolation). Applied after generated migrations.
DO $stays_rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'stay_unit_types',
    'stay_profiles',
    'stay_public_listings',
    'stay_rate_plans',
    'stay_rate_rules',
    'stay_fees',
    'stay_policies',
    'stay_inventory_locks',
    'stay_inventory_days',
    'stay_quotes',
    'stay_holds',
    'stay_bookings',
    'stay_booking_guests',
    'stay_booking_status_history',
    'stay_folios',
    'stay_charges',
    'stay_payment_intents',
    'stay_payment_allocations',
    'stay_refunds'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_private.is_platform_admin() OR organization_id = app_private.current_organization_id()) WITH CHECK (app_private.is_platform_admin() OR organization_id = app_private.current_organization_id())',
      table_name
    );
  END LOOP;
END $stays_rls$;

ALTER TABLE stay_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE stay_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stay_reviews_isolation ON stay_reviews;
CREATE POLICY stay_reviews_isolation ON stay_reviews
USING (
  app_private.is_platform_admin()
  OR (app_private.is_public() AND status = 'published')
  OR organization_id = app_private.current_organization_id()
  OR author_user_id::text = coalesce(current_setting('app.user_id', true), '')
)
WITH CHECK (
  app_private.is_platform_admin()
  OR author_user_id::text = coalesce(current_setting('app.user_id', true), '')
  OR organization_id = app_private.current_organization_id()
);

-- Public read for published stay listings (no owner/guest PII in this table).
DROP POLICY IF EXISTS stay_public_listings_public_read ON stay_public_listings;
CREATE POLICY stay_public_listings_public_read ON stay_public_listings
FOR SELECT
USING (
  app_private.is_platform_admin()
  OR organization_id = app_private.current_organization_id()
  OR (app_private.is_public() AND enabled = true AND published_at IS NOT NULL)
);
