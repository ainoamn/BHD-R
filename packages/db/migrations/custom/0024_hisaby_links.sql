-- Hisaby outbound link: store inbound events URL + encrypted token per organization.
CREATE TABLE IF NOT EXISTS hisaby_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  hisaby_company_id varchar(80),
  events_url text NOT NULL,
  inbound_token_encrypted text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  last_sync_at timestamptz,
  last_sync_status varchar(40),
  last_sync_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS hisaby_links_org_unique ON hisaby_links (organization_id);

ALTER TABLE hisaby_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE hisaby_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hisaby_links;
CREATE POLICY tenant_isolation ON hisaby_links
USING (
  app_private.is_platform_admin()
  OR organization_id = app_private.current_organization_id()
  OR app_private.is_worker()
)
WITH CHECK (
  app_private.is_platform_admin()
  OR organization_id = app_private.current_organization_id()
);

GRANT SELECT, UPDATE (last_sync_at, last_sync_status, last_sync_error, updated_at) ON hisaby_links TO bhd_r_worker;
