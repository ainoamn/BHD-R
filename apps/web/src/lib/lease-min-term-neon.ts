import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { properties, stayPolicies, units } from '@bhd-r/db';
import {
  applyMemberScope,
  getDatabase,
  withElevatedRead,
  type MemberScope,
  type Tx,
} from '@/lib/public-booking-neon';
import { DEFAULT_MIN_LEASE_MONTHS, MAX_LEASE_MONTHS } from '@/lib/reservation-party';

const POLICY_KIND = 'other';

function code(propertyId: string) {
  return `lease_min_term:${propertyId}`;
}

/** Owner's minimum lease term for a property in months; null when the owner kept the default. */
export async function readLeaseMinTerm(
  transaction: Tx,
  organizationId: string,
  propertyId: string,
): Promise<number | null> {
  const row = await transaction.query.stayPolicies.findFirst({
    where: and(
      eq(stayPolicies.organizationId, organizationId),
      eq(stayPolicies.kind, POLICY_KIND),
      eq(stayPolicies.code, code(propertyId)),
      eq(stayPolicies.status, 'active'),
    ),
    orderBy: [desc(stayPolicies.version)],
    columns: { rulesJson: true },
  });
  const months = Number((row?.rulesJson as { months?: unknown } | undefined)?.months);
  return Number.isInteger(months) && months >= 1 && months <= MAX_LEASE_MONTHS ? months : null;
}

export async function effectiveMinLeaseMonths(
  transaction: Tx,
  organizationId: string,
  propertyId: string,
): Promise<number> {
  return (
    (await readLeaseMinTerm(transaction, organizationId, propertyId)) ?? DEFAULT_MIN_LEASE_MONTHS
  );
}

/** Public read for the booking page. */
export async function loadMinLeaseMonthsForUnit(unitId: string): Promise<number> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) =>
    withElevatedRead(transaction, async () => {
      const unit = await transaction.query.units.findFirst({
        where: eq(units.id, unitId),
        columns: { organizationId: true, propertyId: true },
      });
      return unit
        ? effectiveMinLeaseMonths(transaction, unit.organizationId, unit.propertyId)
        : DEFAULT_MIN_LEASE_MONTHS;
    }),
  );
}

export async function loadOwnerLeaseMinTerm(
  scope: MemberScope,
  propertyId: string,
): Promise<number | null> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await applyMemberScope(transaction, scope);
    return readLeaseMinTerm(transaction, scope.organizationId, propertyId);
  });
}

/** `months` null restores the platform default (one year). */
export async function saveLeaseMinTerm(
  claims: SessionClaims,
  propertyId: string,
  months: number | null,
): Promise<{ months: number | null }> {
  const organizationId = claims.organizationId;
  if (!organizationId) throw new Error('organization_required');
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await applyMemberScope(transaction, {
      organizationId,
      userId: claims.sub,
      partyId: claims.partyId,
      roles: claims.roles,
    });
    const property = await transaction.query.properties.findFirst({
      where: and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)),
      columns: { id: true, status: true },
    });
    if (!property) throw new Error('property_not_found');
    if (property.status === 'archived') throw new Error('property_archived');

    const policyCode = code(propertyId);
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:${policyCode}`}))`,
    );
    await transaction
      .update(stayPolicies)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(
        and(
          eq(stayPolicies.organizationId, organizationId),
          eq(stayPolicies.kind, POLICY_KIND),
          eq(stayPolicies.code, policyCode),
          eq(stayPolicies.status, 'active'),
        ),
      );
    if (months === null) return { months: null };

    const [latest] = await transaction
      .select({ version: sql<number>`coalesce(max(${stayPolicies.version}), 0)::int` })
      .from(stayPolicies)
      .where(
        and(
          eq(stayPolicies.organizationId, organizationId),
          eq(stayPolicies.kind, POLICY_KIND),
          eq(stayPolicies.code, policyCode),
        ),
      );
    await transaction.insert(stayPolicies).values({
      organizationId,
      kind: POLICY_KIND,
      code: policyCode,
      nameAr: 'أقل مدة لعقد الإيجار',
      nameEn: 'Minimum lease term',
      version: (latest?.version ?? 0) + 1,
      rulesJson: { scope: 'lease_min_term', propertyId, months, updatedByUserId: claims.sub },
      status: 'active',
    });
    return { months };
  });
}
