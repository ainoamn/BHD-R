-- Custom team roles saved per organization (0.8.54). Additive only.
--
-- A member holding a custom role has a memberships row with role_key 'custom:<organization_roles.id>';
-- at sign-in the role's permissions are merged into the session, so editing a role changes what
-- every holder may do once their sessions refresh.

CREATE TABLE IF NOT EXISTS organization_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name_ar varchar(80) NOT NULL,
  name_en varchar(80) NOT NULL,
  description varchar(300),
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status lifecycle_status NOT NULL DEFAULT 'active',
  created_by_user_id uuid REFERENCES users(id),
  CONSTRAINT organization_roles_permissions_array_check
    CHECK (jsonb_typeof(permissions) = 'array')
);

CREATE INDEX IF NOT EXISTS organization_roles_org_idx
  ON organization_roles (organization_id, status);

ALTER TABLE organization_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_roles_isolation ON organization_roles;
CREATE POLICY organization_roles_isolation ON organization_roles
USING (
  app_private.is_platform_admin()
  OR organization_id = app_private.current_organization_id()
)
WITH CHECK (
  app_private.is_platform_admin()
  OR organization_id = app_private.current_organization_id()
);
