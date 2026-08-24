-- Defense in depth: the API must set these local transaction variables for every request.
CREATE OR REPLACE FUNCTION app_private.current_organization_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
RETURN nullif(current_setting('app.organization_id', true), '')::uuid;

CREATE OR REPLACE FUNCTION app_private.current_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
RETURN nullif(current_setting('app.user_id', true), '')::uuid;

CREATE OR REPLACE FUNCTION app_private.current_party_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
RETURN nullif(current_setting('app.party_id', true), '')::uuid;

CREATE OR REPLACE FUNCTION app_private.is_platform_admin() RETURNS boolean
LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $function$
DECLARE system_role_oid oid;
BEGIN
  IF coalesce(current_setting('app.platform_admin', true), 'false') <> 'true' THEN
    RETURN false;
  END IF;
  SELECT oid INTO system_role_oid FROM pg_roles WHERE rolname = 'bhd_r_system';
  RETURN system_role_oid IS NOT NULL AND pg_has_role(current_user, system_role_oid, 'member');
END
$function$;

CREATE OR REPLACE FUNCTION app_private.is_tenant() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE
RETURN coalesce(current_setting('app.is_tenant', true), 'false') = 'true';

CREATE OR REPLACE FUNCTION app_private.is_public() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE
RETURN coalesce(current_setting('app.public', true), 'false') = 'true';

CREATE OR REPLACE FUNCTION app_private.is_worker() RETURNS boolean
LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $function$
DECLARE worker_role_oid oid;
BEGIN
  IF coalesce(current_setting('app.worker', true), 'false') <> 'true' THEN
    RETURN false;
  END IF;
  SELECT oid INTO worker_role_oid FROM pg_roles WHERE rolname = 'bhd_r_worker';
  RETURN worker_role_oid IS NOT NULL AND pg_has_role(current_user, worker_role_oid, 'member');
END
$function$;

CREATE OR REPLACE FUNCTION app_private.tenant_has_unit(target_unit_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
RETURN EXISTS (
  SELECT 1 FROM leases
  WHERE leases.unit_id = target_unit_id
    AND leases.tenant_party_id = app_private.current_party_id()
    AND leases.status IN ('active', 'ended')
);

CREATE OR REPLACE FUNCTION app_private.public_unit_available(target_unit_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
RETURN EXISTS (
  SELECT 1
  FROM units u
  JOIN listings l ON l.unit_id = u.id
  JOIN properties p ON p.id = u.property_id
  WHERE u.id = target_unit_id
    AND u.status = 'active' AND p.status = 'active'
    AND u.publish_when_available AND l.enabled AND l.published_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM holds h WHERE h.unit_id = u.id AND h.status = 'active' AND h.expires_at > now())
    AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.unit_id = u.id AND r.status IN ('pending','confirmed') AND r.expires_at > now())
    AND NOT EXISTS (SELECT 1 FROM leases x WHERE x.unit_id = u.id AND x.status IN ('draft','active') AND x.ends_on >= current_date)
    AND NOT EXISTS (SELECT 1 FROM maintenance_tickets m WHERE m.unit_id = u.id AND m.blocks_availability AND m.status NOT IN ('resolved','closed','cancelled'))
);

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'holds','reservations','contract_templates',
    'payment_gateway_settings','idempotency_keys','audit_logs','report_jobs','outbox_events','api_keys','signature_challenges',
    'contract_sequences','receipt_sequences'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_private.is_platform_admin() OR organization_id = app_private.current_organization_id()) WITH CHECK (app_private.is_platform_admin() OR organization_id = app_private.current_organization_id())',
      table_name
    );
  END LOOP;
END $rls$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_isolation ON organizations;
CREATE POLICY organizations_isolation ON organizations
USING (app_private.is_platform_admin() OR id = app_private.current_organization_id())
WITH CHECK (app_private.is_platform_admin() OR id = app_private.current_organization_id());

ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE addresses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS addresses_isolation ON addresses;
CREATE POLICY addresses_isolation ON addresses
USING (
  app_private.is_platform_admin()
  OR organization_id = app_private.current_organization_id()
  OR (app_private.is_public() AND EXISTS (
    SELECT 1 FROM properties p JOIN units u ON u.property_id = p.id
    WHERE p.address_id = addresses.id AND app_private.public_unit_available(u.id)
  ))
)
WITH CHECK (app_private.is_platform_admin() OR organization_id = app_private.current_organization_id());

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memberships_isolation ON memberships;
CREATE POLICY memberships_isolation ON memberships
USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND (NOT app_private.is_tenant() OR user_id = app_private.current_user_id())))
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS parties_isolation ON parties;
CREATE POLICY parties_isolation ON parties
USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND (NOT app_private.is_tenant() OR id = app_private.current_party_id())))
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

ALTER TABLE party_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS party_roles_isolation ON party_roles;
CREATE POLICY party_roles_isolation ON party_roles
USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND (NOT app_private.is_tenant() OR party_id = app_private.current_party_id())))
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

ALTER TABLE party_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_addresses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS party_addresses_isolation ON party_addresses;
CREATE POLICY party_addresses_isolation ON party_addresses
USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND (NOT app_private.is_tenant() OR party_id = app_private.current_party_id())))
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

ALTER TABLE party_identity_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_identity_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS party_identity_documents_isolation ON party_identity_documents;
CREATE POLICY party_identity_documents_isolation ON party_identity_documents
USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND (NOT app_private.is_tenant() OR party_id = app_private.current_party_id())))
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

ALTER TABLE representation_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE representation_authorities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS representation_authorities_isolation ON representation_authorities;
CREATE POLICY representation_authorities_isolation ON representation_authorities
USING (
  app_private.is_platform_admin()
  OR (
    organization_id = app_private.current_organization_id()
    AND (
      NOT app_private.is_tenant()
      OR principal_party_id = app_private.current_party_id()
      OR representative_party_id = app_private.current_party_id()
    )
  )
)
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS properties_isolation ON properties;
CREATE POLICY properties_isolation ON properties
USING (
  app_private.is_platform_admin()
  OR (organization_id = app_private.current_organization_id() AND (NOT app_private.is_tenant() OR EXISTS (SELECT 1 FROM units u WHERE u.property_id = properties.id AND app_private.tenant_has_unit(u.id))))
  OR (app_private.is_public() AND EXISTS (SELECT 1 FROM units u WHERE u.property_id = properties.id AND app_private.public_unit_available(u.id)))
)
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE units FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS units_isolation ON units;
CREATE POLICY units_isolation ON units
USING (
  app_private.is_platform_admin()
  OR (organization_id = app_private.current_organization_id() AND (NOT app_private.is_tenant() OR app_private.tenant_has_unit(id)))
  OR (app_private.is_public() AND app_private.public_unit_available(id))
)
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS listings_isolation ON listings;
CREATE POLICY listings_isolation ON listings
USING (
  app_private.is_platform_admin()
  OR (organization_id = app_private.current_organization_id() AND (NOT app_private.is_tenant() OR app_private.tenant_has_unit(unit_id)))
  OR (app_private.is_public() AND app_private.public_unit_available(unit_id))
)
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

ALTER TABLE leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE leases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leases_isolation ON leases;
CREATE POLICY leases_isolation ON leases
USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND (NOT app_private.is_tenant() OR tenant_party_id = app_private.current_party_id())))
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contracts_isolation ON contracts;
CREATE POLICY contracts_isolation ON contracts
USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND (NOT app_private.is_tenant() OR tenant_party_id = app_private.current_party_id())))
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

ALTER TABLE contract_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_signatures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contract_signatures_isolation ON contract_signatures;
CREATE POLICY contract_signatures_isolation ON contract_signatures
USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND (NOT app_private.is_tenant() OR signer_party_id = app_private.current_party_id())))
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND (NOT app_private.is_tenant() OR signer_party_id = app_private.current_party_id())));

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_isolation ON invoices;
CREATE POLICY invoices_isolation ON invoices
USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND (NOT app_private.is_tenant() OR tenant_party_id = app_private.current_party_id())))
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

ALTER TABLE billing_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_schedules_isolation ON billing_schedules;
CREATE POLICY billing_schedules_isolation ON billing_schedules
USING (
  app_private.is_platform_admin()
  OR (
    organization_id = app_private.current_organization_id()
    AND (
      NOT app_private.is_tenant()
      OR EXISTS (
        SELECT 1 FROM leases l
        WHERE l.id = billing_schedules.lease_id
          AND l.tenant_party_id = app_private.current_party_id()
      )
    )
  )
)
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

DO $sensitive$
DECLARE pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['invoice_lines','EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id AND (NOT app_private.is_tenant() OR i.tenant_party_id = app_private.current_party_id()))'],
    ['payments','EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id AND (NOT app_private.is_tenant() OR i.tenant_party_id = app_private.current_party_id()))'],
    ['payment_sessions','EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id AND (NOT app_private.is_tenant() OR i.tenant_party_id = app_private.current_party_id()))'],
    ['refunds','EXISTS (SELECT 1 FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = payment_id AND (NOT app_private.is_tenant() OR i.tenant_party_id = app_private.current_party_id()))'],
    ['receipts','EXISTS (SELECT 1 FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = payment_id AND (NOT app_private.is_tenant() OR i.tenant_party_id = app_private.current_party_id()))'],
    ['maintenance_tickets','(NOT app_private.is_tenant() OR app_private.tenant_has_unit(unit_id))'],
    ['unit_media','(NOT app_private.is_tenant() OR app_private.tenant_has_unit(unit_id))'],
    ['media_assets','NOT app_private.is_tenant() OR EXISTS (SELECT 1 FROM unit_media um WHERE um.media_asset_id = id AND app_private.tenant_has_unit(um.unit_id))']
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', pair[1]);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', pair[1]);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', pair[1]);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND %s)) WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()))', pair[1], pair[2]);
  END LOOP;
END $sensitive$;

DROP POLICY IF EXISTS tenant_isolation ON unit_media;
CREATE POLICY tenant_isolation ON unit_media
USING (
  app_private.is_platform_admin()
  OR (organization_id = app_private.current_organization_id() AND (NOT app_private.is_tenant() OR app_private.tenant_has_unit(unit_id)))
  OR (app_private.is_public() AND app_private.public_unit_available(unit_id))
)
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

DROP POLICY IF EXISTS tenant_isolation ON media_assets;
CREATE POLICY tenant_isolation ON media_assets
USING (
  app_private.is_platform_admin()
  OR (
    organization_id = app_private.current_organization_id()
    AND (
      NOT app_private.is_tenant()
      OR EXISTS (SELECT 1 FROM unit_media um WHERE um.media_asset_id = id AND app_private.tenant_has_unit(um.unit_id))
      OR EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.id = nullif(media_assets.metadata->>'reservationId', '')::uuid
          AND r.tenant_party_id = app_private.current_party_id()
      )
    )
  )
  OR (app_private.is_public() AND processing_status = 'ready' AND scan_status = 'clean' AND EXISTS (SELECT 1 FROM unit_media um WHERE um.media_asset_id = id AND app_private.public_unit_available(um.unit_id)))
)
WITH CHECK (
  app_private.is_platform_admin()
  OR (
    organization_id = app_private.current_organization_id()
    AND (
      NOT app_private.is_tenant()
      OR (
        uploaded_by_user_id = app_private.current_user_id()
        AND EXISTS (
          SELECT 1 FROM reservations r
          WHERE r.id = nullif(media_assets.metadata->>'reservationId', '')::uuid
            AND r.tenant_party_id = app_private.current_party_id()
        )
      )
    )
  )
);

ALTER TABLE reservation_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_requirements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reservation_requirements_select ON reservation_requirements;
CREATE POLICY reservation_requirements_select ON reservation_requirements FOR SELECT
USING (
  app_private.is_platform_admin()
  OR (
    organization_id = app_private.current_organization_id()
    AND (
      NOT app_private.is_tenant()
      OR EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.id = reservation_id AND r.tenant_party_id = app_private.current_party_id()
      )
    )
  )
);
DROP POLICY IF EXISTS reservation_requirements_staff_write ON reservation_requirements;
CREATE POLICY reservation_requirements_staff_write ON reservation_requirements FOR ALL
USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()))
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

ALTER TABLE reservation_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reservation_documents_select ON reservation_documents;
CREATE POLICY reservation_documents_select ON reservation_documents FOR SELECT
USING (
  app_private.is_platform_admin()
  OR (
    organization_id = app_private.current_organization_id()
    AND (
      NOT app_private.is_tenant()
      OR EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.id = reservation_id AND r.tenant_party_id = app_private.current_party_id()
      )
    )
  )
);
DROP POLICY IF EXISTS reservation_documents_insert ON reservation_documents;
CREATE POLICY reservation_documents_insert ON reservation_documents FOR INSERT
WITH CHECK (
  app_private.is_platform_admin()
  OR (
    organization_id = app_private.current_organization_id()
    AND submitted_by_user_id = app_private.current_user_id()
    AND (
      NOT app_private.is_tenant()
      OR EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.id = reservation_id AND r.tenant_party_id = app_private.current_party_id()
      )
    )
  )
);
DROP POLICY IF EXISTS reservation_documents_staff_update ON reservation_documents;
CREATE POLICY reservation_documents_staff_update ON reservation_documents FOR UPDATE
USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()))
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_sequences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_sequences_isolation ON invoice_sequences;
CREATE POLICY invoice_sequences_isolation ON invoice_sequences
USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()))
WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()));

-- Authentication records are self-only; credential token lookup is performed by a narrowly scoped DB role in production.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS session_self ON sessions;
CREATE POLICY session_self ON sessions USING (app_private.is_platform_admin() OR user_id = app_private.current_user_id()) WITH CHECK (app_private.is_platform_admin() OR user_id = app_private.current_user_id());

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_self ON users;
CREATE POLICY user_self ON users USING (app_private.is_platform_admin() OR id = app_private.current_user_id()) WITH CHECK (app_private.is_platform_admin() OR id = app_private.current_user_id());

ALTER TABLE credential_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credential_token_self ON credential_tokens;
CREATE POLICY credential_token_self ON credential_tokens USING (app_private.is_platform_admin() OR user_id = app_private.current_user_id()) WITH CHECK (app_private.is_platform_admin() OR user_id = app_private.current_user_id());

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_events_service_only ON webhook_events;
CREATE POLICY webhook_events_service_only ON webhook_events
USING (
  app_private.is_platform_admin()
  OR (coalesce(current_setting('app.webhook_consumer', true), 'false') = 'true' AND app_private.is_platform_admin())
  OR organization_id = app_private.current_organization_id()
)
WITH CHECK (
  app_private.is_platform_admin()
  OR (coalesce(current_setting('app.webhook_consumer', true), 'false') = 'true' AND app_private.is_platform_admin())
);

-- Worker is a separate service principal. RLS limits rows; deployment grants limit columns.
DO $worker_select$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'outbox_events','media_assets','unit_media','units','contracts','contract_templates',
    'invoices','credential_tokens','users','report_jobs','properties','leases','payments',
    'maintenance_tickets','sales_deals','legal_cases','work_tasks','operational_requests',
    'ledger_accounts','journal_entries','journal_sequences','journal_lines','expenses','parties','addresses',
    'party_roles','party_addresses','representation_authorities','billing_schedules',
    'payment_sessions','refunds','receipts','receipt_sequences','contract_sequences'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS worker_select ON %I', table_name);
    EXECUTE format('CREATE POLICY worker_select ON %I FOR SELECT USING (app_private.is_worker())', table_name);
  END LOOP;
END $worker_select$;

DROP POLICY IF EXISTS worker_update ON outbox_events;
CREATE POLICY worker_update ON outbox_events FOR UPDATE USING (app_private.is_worker()) WITH CHECK (app_private.is_worker());
DROP POLICY IF EXISTS worker_update ON media_assets;
CREATE POLICY worker_update ON media_assets FOR UPDATE USING (app_private.is_worker()) WITH CHECK (app_private.is_worker());
DROP POLICY IF EXISTS worker_update ON contracts;
CREATE POLICY worker_update ON contracts FOR UPDATE USING (app_private.is_worker()) WITH CHECK (app_private.is_worker());
DROP POLICY IF EXISTS worker_update ON invoices;
CREATE POLICY worker_update ON invoices FOR UPDATE USING (app_private.is_worker()) WITH CHECK (app_private.is_worker());
DROP POLICY IF EXISTS worker_update ON receipts;
CREATE POLICY worker_update ON receipts FOR UPDATE USING (app_private.is_worker()) WITH CHECK (app_private.is_worker());
DROP POLICY IF EXISTS worker_update ON report_jobs;
CREATE POLICY worker_update ON report_jobs FOR UPDATE USING (app_private.is_worker()) WITH CHECK (app_private.is_worker());

-- Operational suites are organization-private. Tenants can only see or submit their own
-- general requests; accounting, sales, legal, task and vendor records remain staff-only.
ALTER TABLE operational_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_requests_isolation ON operational_requests;
CREATE POLICY operational_requests_isolation ON operational_requests
USING (
  app_private.is_platform_admin()
  OR (
    organization_id = app_private.current_organization_id()
    AND (NOT app_private.is_tenant() OR requester_party_id = app_private.current_party_id())
  )
)
WITH CHECK (
  app_private.is_platform_admin()
  OR (
    organization_id = app_private.current_organization_id()
    AND (NOT app_private.is_tenant() OR requester_party_id = app_private.current_party_id())
  )
);

DO $operations_rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'work_tasks','viewing_requests','sales_deals','vendors','maintenance_work_orders',
    'legal_cases','legal_events','ledger_accounts','journal_entries','journal_sequences','journal_lines',
    'expenses','approval_requests','workflow_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS staff_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY staff_isolation ON %I USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant())) WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()))',
      table_name
    );
  END LOOP;
END $operations_rls$;

-- Detailed ownership, facility, meter and compliance records are deliberately
-- private to organization staff. Public listing endpoints expose only an explicit
-- allow-list assembled by the portfolio service.
DO $property_operations_rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'property_profiles','property_amenities','property_ownership_interests',
    'utility_meters','property_documents'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS staff_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY staff_isolation ON %I USING (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant())) WITH CHECK (app_private.is_platform_admin() OR (organization_id = app_private.current_organization_id() AND NOT app_private.is_tenant()))',
      table_name
    );
  END LOOP;
END $property_operations_rls$;


REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
