-- RLS for stay_housekeeping_tasks
ALTER TABLE stay_housekeeping_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE stay_housekeeping_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stay_housekeeping_tasks;
CREATE POLICY tenant_isolation ON stay_housekeeping_tasks
USING (
  app_private.is_platform_admin()
  OR organization_id = app_private.current_organization_id()
)
WITH CHECK (
  app_private.is_platform_admin()
  OR organization_id = app_private.current_organization_id()
);
