/**
 * Blocks an owner/staff account from booking its own inventory as a guest.
 * The same signed-in account that runs the property cannot rent, buy, stay in,
 * or request a viewing of a unit that belongs to that organization.
 */
import 'server-only';
import { and, eq } from 'drizzle-orm';
import { memberships, type Database } from '@bhd-r/db';

import { OWNER_PORTAL_ROLES } from '@/lib/portal-access';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const OWNER_SIDE_ROLES = new Set(OWNER_PORTAL_ROLES);

export async function userOperatesOrganization(
  transaction: Tx,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const rows = await transaction
    .select({ roleKey: memberships.roleKey })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, 'active'),
      ),
    );
  return rows.some((row) => OWNER_SIDE_ROLES.has(row.roleKey));
}

/** Throws Error('own_property') when the booker account manages this organization. */
export async function assertMayBookAsGuest(
  transaction: Tx,
  userId: string,
  organizationId: string,
): Promise<void> {
  if (await userOperatesOrganization(transaction, userId, organizationId)) {
    throw new Error('own_property');
  }
}
