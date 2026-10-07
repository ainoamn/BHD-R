import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { properties, stayPolicies, units } from '@bhd-r/db';
import {
  BOOKING_TERMS_MODES,
  bookingTermsModeLabel,
  checkoutTermsFromOwner,
  parseTermsBody,
  type BookingTermsForCheckout,
  type BookingTermsMode,
  type OwnerBookingTerms,
} from '@/lib/booking-terms';
import { getDatabase, withElevatedRead, type Tx } from '@/lib/public-booking-neon';

const POLICY_KIND = 'other';

function termsCode(mode: BookingTermsMode, propertyId: string) {
  return `booking_terms:${mode}:${propertyId}`;
}

type OwnerScope = {
  organizationId: string;
  userId: string;
  partyId?: string | null;
  roles?: readonly string[];
};

async function applyOwnerScope(transaction: Tx, scope: OwnerScope) {
  const roles = scope.roles ?? [];
  await transaction.execute(sql`select set_config('app.organization_id', ${scope.organizationId}, true)`);
  await transaction.execute(sql`select set_config('app.user_id', ${scope.userId}, true)`);
  await transaction.execute(sql`select set_config('app.party_id', ${scope.partyId ?? ''}, true)`);
  await transaction.execute(
    sql`select set_config('app.platform_admin', ${String(roles.includes('platform_admin'))}, true)`,
  );
  await transaction.execute(
    sql`select set_config('app.is_tenant', ${String(roles.includes('tenant'))}, true)`,
  );
  await transaction.execute(sql`select set_config('app.public', 'false', true)`);
}

/** Latest active owner terms — caller must already be scoped to `organizationId`. */
export async function readActiveBookingTerms(
  transaction: Tx,
  organizationId: string,
  propertyId: string,
  mode: BookingTermsMode,
): Promise<OwnerBookingTerms | null> {
  const row = await transaction.query.stayPolicies.findFirst({
    where: and(
      eq(stayPolicies.organizationId, organizationId),
      eq(stayPolicies.kind, POLICY_KIND),
      eq(stayPolicies.code, termsCode(mode, propertyId)),
      eq(stayPolicies.status, 'active'),
    ),
    orderBy: [desc(stayPolicies.version)],
  });
  if (!row) return null;
  if (!parseTermsBody(row.bodyAr).length && !parseTermsBody(row.bodyEn).length) return null;
  return {
    version: row.version,
    bodyAr: row.bodyAr,
    bodyEn: row.bodyEn,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type OwnerBookingTermsPage = {
  property: { id: string; nameAr: string; nameEn: string };
  terms: Record<BookingTermsMode, OwnerBookingTerms | null>;
};

export async function loadOwnerBookingTerms(
  scope: OwnerScope,
  propertyId: string,
): Promise<OwnerBookingTermsPage | null> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await applyOwnerScope(transaction, scope);
    const property = await transaction.query.properties.findFirst({
      where: and(eq(properties.id, propertyId), eq(properties.organizationId, scope.organizationId)),
      columns: { id: true, nameAr: true, nameEn: true },
    });
    if (!property) return null;
    const terms = {} as Record<BookingTermsMode, OwnerBookingTerms | null>;
    for (const mode of BOOKING_TERMS_MODES) {
      terms[mode] = await readActiveBookingTerms(transaction, scope.organizationId, propertyId, mode);
    }
    return { property, terms };
  });
}

/** Saves a new version; empty bodies archive the owner text so platform defaults apply again. */
export async function saveOwnerBookingTerms(
  claims: SessionClaims,
  propertyId: string,
  mode: BookingTermsMode,
  body: { bodyAr: string; bodyEn: string },
): Promise<{ ok: true; terms: OwnerBookingTerms | null }> {
  const organizationId = claims.organizationId;
  if (!organizationId) throw new Error('organization_required');
  const bodyAr = body.bodyAr.trim();
  const bodyEn = body.bodyEn.trim();
  const code = termsCode(mode, propertyId);

  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await applyOwnerScope(transaction, {
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

    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:${code}`}))`);

    await transaction
      .update(stayPolicies)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(
        and(
          eq(stayPolicies.organizationId, organizationId),
          eq(stayPolicies.kind, POLICY_KIND),
          eq(stayPolicies.code, code),
          eq(stayPolicies.status, 'active'),
        ),
      );

    if (!parseTermsBody(bodyAr).length && !parseTermsBody(bodyEn).length) {
      return { ok: true as const, terms: null };
    }

    const [latest] = await transaction
      .select({ version: sql<number>`coalesce(max(${stayPolicies.version}), 0)::int` })
      .from(stayPolicies)
      .where(
        and(
          eq(stayPolicies.organizationId, organizationId),
          eq(stayPolicies.kind, POLICY_KIND),
          eq(stayPolicies.code, code),
        ),
      );

    const [row] = await transaction
      .insert(stayPolicies)
      .values({
        organizationId,
        kind: POLICY_KIND,
        code,
        nameAr: `الشروط والأحكام — ${bookingTermsModeLabel(mode, true)}`.slice(0, 160),
        nameEn: `Terms and conditions — ${bookingTermsModeLabel(mode, false)}`.slice(0, 160),
        version: (latest?.version ?? 0) + 1,
        bodyAr: bodyAr || null,
        bodyEn: bodyEn || null,
        rulesJson: { scope: 'booking_terms', propertyId, mode, updatedByUserId: claims.sub },
        status: 'active',
      })
      .returning();

    return {
      ok: true as const,
      terms: row
        ? {
            version: row.version,
            bodyAr: row.bodyAr,
            bodyEn: row.bodyEn,
            updatedAt: row.updatedAt.toISOString(),
          }
        : null,
    };
  });
}

/** Public read for checkout pages — only the owner's terms text, never other org data. */
export async function loadBookingTermsForUnit(
  unitId: string,
  modes: readonly BookingTermsMode[],
): Promise<Partial<Record<BookingTermsMode, BookingTermsForCheckout>>> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) =>
    withElevatedRead(transaction, async () => {
      const unit = await transaction.query.units.findFirst({
        where: eq(units.id, unitId),
        columns: { organizationId: true, propertyId: true },
      });
      const result: Partial<Record<BookingTermsMode, BookingTermsForCheckout>> = {};
      for (const mode of modes) {
        const owner = unit
          ? await readActiveBookingTerms(transaction, unit.organizationId, unit.propertyId, mode)
          : null;
        result[mode] = checkoutTermsFromOwner(owner);
      }
      return result;
    }),
  );
}

export async function loadBookingTermsForProperty(
  organizationId: string,
  propertyId: string,
  mode: BookingTermsMode,
): Promise<OwnerBookingTerms | null> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) =>
    withElevatedRead(transaction, () =>
      readActiveBookingTerms(transaction, organizationId, propertyId, mode),
    ),
  );
}
