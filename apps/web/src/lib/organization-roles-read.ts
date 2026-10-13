import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { organizationRoles, type Database } from '@bhd-r/db';

type Reader = Pick<Database, 'select'>;

/** Current permissions of an organization's active saved roles, by role id. */
export async function loadSavedRolePermissions(
  reader: Reader,
  organizationId: string,
  roleIds: readonly string[],
): Promise<Map<string, string[]>> {
  const ids = roleIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return new Map();
  const rows = await reader
    .select({ id: organizationRoles.id, permissions: organizationRoles.permissions })
    .from(organizationRoles)
    .where(
      and(
        eq(organizationRoles.organizationId, organizationId),
        inArray(organizationRoles.id, ids),
        eq(organizationRoles.status, 'active'),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.permissions]));
}
