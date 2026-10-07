import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { addresses, parties, properties, stayPolicies, units } from '@bhd-r/db';
import {
  BOOKING_TERMS_MODES,
  bookingTermsModeLabel,
  bookingTermsRef,
  checkoutTermsFromOwner,
  parseTermsBody,
  type BookingTermsForCheckout,
  type BookingTermsMode,
  type BookingTermsSource,
  type OwnerBookingTerms,
} from '@/lib/booking-terms';
import {
  applyMemberScope as applyOwnerScope,
  getDatabase,
  withElevatedRead,
  type MemberScope as OwnerScope,
  type Tx,
} from '@/lib/public-booking-neon';

const POLICY_KIND = 'other';
const ORGANIZATION_SCOPE = 'org';

/** `propertyId` null = the organization-wide template every property inherits. */
function termsCode(mode: BookingTermsMode, propertyId: string | null) {
  return `booking_terms:${mode}:${propertyId ?? ORGANIZATION_SCOPE}`;
}

type TermsMap = Record<BookingTermsMode, OwnerBookingTerms | null>;

/** Latest active terms for one scope — caller must already be scoped to `organizationId`. */
export async function readActiveBookingTerms(
  transaction: Tx,
  organizationId: string,
  propertyId: string | null,
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

export type ResolvedBookingTerms = {
  source: BookingTermsSource;
  ref: string;
  terms: OwnerBookingTerms | null;
};

/** Property override → organization template → platform defaults. */
export async function resolveBookingTerms(
  transaction: Tx,
  organizationId: string,
  propertyId: string,
  mode: BookingTermsMode,
): Promise<ResolvedBookingTerms> {
  const own = await readActiveBookingTerms(transaction, organizationId, propertyId, mode);
  if (own) return { source: 'property', ref: bookingTermsRef('property', own.version), terms: own };
  const shared = await readActiveBookingTerms(transaction, organizationId, null, mode);
  if (shared) {
    return {
      source: 'organization',
      ref: bookingTermsRef('organization', shared.version),
      terms: shared,
    };
  }
  return { source: 'default', ref: 'default', terms: null };
}

async function readTermsMap(transaction: Tx, organizationId: string, propertyId: string | null) {
  const map = {} as TermsMap;
  for (const mode of BOOKING_TERMS_MODES) {
    map[mode] = await readActiveBookingTerms(transaction, organizationId, propertyId, mode);
  }
  return map;
}

export type OwnerBookingTermsPage = {
  property: { id: string; nameAr: string; nameEn: string };
  terms: TermsMap;
  organizationTerms: TermsMap;
};

export async function loadOwnerBookingTerms(
  scope: OwnerScope,
  propertyId: string,
): Promise<OwnerBookingTermsPage | null> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await applyOwnerScope(transaction, scope);
    const property = await transaction.query.properties.findFirst({
      where: and(
        eq(properties.id, propertyId),
        eq(properties.organizationId, scope.organizationId),
      ),
      columns: { id: true, nameAr: true, nameEn: true },
    });
    if (!property) return null;
    return {
      property,
      terms: await readTermsMap(transaction, scope.organizationId, propertyId),
      organizationTerms: await readTermsMap(transaction, scope.organizationId, null),
    };
  });
}

export type BookingTermsOverviewRow = {
  id: string;
  nameAr: string;
  nameEn: string;
  serialNumber: string | null;
  ownerName: string | null;
  governorate: string | null;
  wilayat: string | null;
  location: string;
  versions: Partial<Record<BookingTermsMode, { version: number; updatedAt: string }>>;
};

export type BookingTermsOverview = {
  organizationTerms: TermsMap;
  properties: BookingTermsOverviewRow[];
};

/** Organization template plus every property and which booking types it overrides. */
export async function loadBookingTermsOverview(scope: OwnerScope): Promise<BookingTermsOverview> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await applyOwnerScope(transaction, scope);
    const propertyRows = await transaction
      .select({
        id: properties.id,
        nameAr: properties.nameAr,
        nameEn: properties.nameEn,
        serialNumber: properties.serialNumber,
        ownerName: parties.displayName,
        governorate: addresses.governorate,
        wilayat: addresses.wilayat,
        city: addresses.city,
        street: addresses.street,
      })
      .from(properties)
      .leftJoin(parties, eq(parties.id, properties.ownerPartyId))
      .leftJoin(addresses, eq(addresses.id, properties.addressId))
      .where(
        and(
          eq(properties.organizationId, scope.organizationId),
          sql`${properties.status} <> 'archived'`,
        ),
      )
      .orderBy(desc(properties.updatedAt))
      .limit(500);

    const policyRows = await transaction
      .select({
        code: stayPolicies.code,
        version: stayPolicies.version,
        updatedAt: stayPolicies.updatedAt,
        bodyAr: stayPolicies.bodyAr,
        bodyEn: stayPolicies.bodyEn,
      })
      .from(stayPolicies)
      .where(
        and(
          eq(stayPolicies.organizationId, scope.organizationId),
          eq(stayPolicies.kind, POLICY_KIND),
          eq(stayPolicies.status, 'active'),
          sql`${stayPolicies.code} like 'booking_terms:%'`,
        ),
      );

    const byProperty = new Map<string, BookingTermsOverviewRow['versions']>();
    for (const row of policyRows) {
      const [, mode, scopeId] = row.code.split(':');
      if (!scopeId || scopeId === ORGANIZATION_SCOPE) continue;
      if (!BOOKING_TERMS_MODES.includes(mode as BookingTermsMode)) continue;
      if (!parseTermsBody(row.bodyAr).length && !parseTermsBody(row.bodyEn).length) continue;
      const versions = byProperty.get(scopeId) ?? {};
      const current = versions[mode as BookingTermsMode];
      if (!current || current.version < row.version) {
        versions[mode as BookingTermsMode] = {
          version: row.version,
          updatedAt: row.updatedAt.toISOString(),
        };
      }
      byProperty.set(scopeId, versions);
    }

    return {
      organizationTerms: await readTermsMap(transaction, scope.organizationId, null),
      properties: propertyRows.map(({ city, street, ...row }) => ({
        ...row,
        location: [street, city, row.wilayat, row.governorate].filter(Boolean).join(' · '),
        versions: byProperty.get(row.id) ?? {},
      })),
    };
  });
}

/**
 * Saves a new version for a property (`propertyId`) or the organization template (null).
 * Empty bodies archive the text: a property falls back to the template, the template to platform defaults.
 */
export async function saveOwnerBookingTerms(
  claims: SessionClaims,
  propertyId: string | null,
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
    if (propertyId) {
      const property = await transaction.query.properties.findFirst({
        where: and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)),
        columns: { id: true, status: true },
      });
      if (!property) throw new Error('property_not_found');
      if (property.status === 'archived') throw new Error('property_archived');
    }

    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:${code}`}))`,
    );

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

    const label = bookingTermsModeLabel(mode, true);
    const labelEn = bookingTermsModeLabel(mode, false);
    const [row] = await transaction
      .insert(stayPolicies)
      .values({
        organizationId,
        kind: POLICY_KIND,
        code,
        nameAr: (propertyId
          ? `الشروط والأحكام — ${label}`
          : `الصيغة الموحدة للشروط — ${label}`
        ).slice(0, 160),
        nameEn: (propertyId
          ? `Terms and conditions — ${labelEn}`
          : `Standard terms — ${labelEn}`
        ).slice(0, 160),
        version: (latest?.version ?? 0) + 1,
        bodyAr: bodyAr || null,
        bodyEn: bodyEn || null,
        rulesJson: {
          scope: propertyId ? 'booking_terms' : 'booking_terms_template',
          propertyId,
          mode,
          updatedByUserId: claims.sub,
        },
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

function toCheckout(resolved: ResolvedBookingTerms): BookingTermsForCheckout {
  return resolved.source === 'default' || !resolved.terms
    ? checkoutTermsFromOwner(null)
    : checkoutTermsFromOwner(resolved.terms, resolved.source);
}

/** Public read for checkout pages — only the effective terms text, never other org data. */
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
        result[mode] = unit
          ? toCheckout(
              await resolveBookingTerms(transaction, unit.organizationId, unit.propertyId, mode),
            )
          : checkoutTermsFromOwner(null);
      }
      return result;
    }),
  );
}

export async function loadBookingTermsForProperty(
  organizationId: string,
  propertyId: string,
  mode: BookingTermsMode,
): Promise<ResolvedBookingTerms> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) =>
    withElevatedRead(transaction, () =>
      resolveBookingTerms(transaction, organizationId, propertyId, mode),
    ),
  );
}
