/**
 * Blocks an owner/staff account from booking its own inventory as a guest.
 * Same signed-in account that runs the property cannot rent, buy, stay in,
 * or request a viewing of a unit belonging to that organization.
 */
import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { memberships, parties, users, type Database } from '@bhd-r/db';

import { isOwnerSideRole } from '@/lib/portal-access';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type OwnPropertyBooker = {
  userId: string;
  organizationId: string;
  /** JWT org — when it matches the unit org and roles are owner-side, block without a DB round-trip. */
  sessionOrganizationId?: string | null;
  roles?: readonly string[];
  partyId?: string | null;
  email?: string | null;
  ownerPartyId?: string | null;
};

async function withElevatedMembershipRead<T>(transaction: Tx, work: () => Promise<T>): Promise<T> {
  await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
  try {
    return await work();
  } finally {
    await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
  }
}

async function resolveBookerEmail(
  transaction: Tx,
  userId: string,
  email: string | null | undefined,
): Promise<string | null> {
  const fromInput = email?.trim().toLowerCase() || null;
  if (fromInput) return fromInput;
  return withElevatedMembershipRead(transaction, async () => {
    const row = await transaction.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { email: true },
    });
    return row?.email?.trim().toLowerCase() ?? null;
  });
}

export async function userOperatesOrganization(
  transaction: Tx,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  return withElevatedMembershipRead(transaction, async () => {
    const rows = await transaction
      .select({ roleKey: memberships.roleKey, partyId: memberships.partyId })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, 'active'),
        ),
      );
    return rows.some((row) => isOwnerSideRole(row.roleKey));
  });
}

async function userOwnsPropertyParty(
  transaction: Tx,
  input: OwnPropertyBooker & { resolvedEmail: string | null },
): Promise<boolean> {
  if (!input.ownerPartyId) return false;
  if (input.partyId && input.partyId === input.ownerPartyId) return true;

  return withElevatedMembershipRead(transaction, async () => {
    const owner = await transaction.query.parties.findFirst({
      where: and(
        eq(parties.id, input.ownerPartyId!),
        eq(parties.organizationId, input.organizationId),
      ),
      columns: { id: true, email: true, metadata: true },
    });
    if (!owner) return false;

    const meta =
      owner.metadata && typeof owner.metadata === 'object' && !Array.isArray(owner.metadata)
        ? (owner.metadata as Record<string, unknown>)
        : {};
    if (typeof meta.userId === 'string' && meta.userId === input.userId) return true;

    const ownerEmail = owner.email?.trim().toLowerCase() ?? '';
    if (ownerEmail && input.resolvedEmail && ownerEmail === input.resolvedEmail) return true;

    const membership = await transaction
      .select({ partyId: memberships.partyId })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, input.userId),
          eq(memberships.organizationId, input.organizationId),
          eq(memberships.status, 'active'),
          eq(memberships.partyId, input.ownerPartyId!),
        ),
      )
      .limit(1);
    return membership.length > 0;
  });
}

/** Throws Error('own_property') when the booker account owns or operates this organization/unit. */
export async function assertMayBookAsGuest(
  transaction: Tx,
  input: OwnPropertyBooker,
): Promise<void> {
  const roles = input.roles ?? [];
  if (
    input.sessionOrganizationId &&
    input.sessionOrganizationId === input.organizationId &&
    roles.some(isOwnerSideRole)
  ) {
    throw new Error('own_property');
  }

  if (await userOperatesOrganization(transaction, input.userId, input.organizationId)) {
    throw new Error('own_property');
  }

  const resolvedEmail = await resolveBookerEmail(transaction, input.userId, input.email);
  if (await userOwnsPropertyParty(transaction, { ...input, resolvedEmail })) {
    throw new Error('own_property');
  }
}
