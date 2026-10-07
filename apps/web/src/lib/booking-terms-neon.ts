import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { addresses, organizations, parties, properties, stayPolicies, units } from '@bhd-r/db';
import {
  BOOKING_TERMS_MODES,
  bookingTermsModeLabel,
  bookingTermsRef,
  checkoutTermsFromOwner,
  emptyLetterhead,
  hasTermsText,
  parseTermsBody,
  sanitizeLetterhead,
  sanitizeTermsBlocks,
  termsBlocksFromStored,
  termsBodiesFromBlocks,
  type BookingTermsForCheckout,
  type BookingTermsMode,
  type BookingTermsSource,
  type OwnerBookingTerms,
  type TermsBlock,
  type TermsLetterhead,
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
  const blocks = termsBlocksFromStored({
    blocks: (row.rulesJson as { blocks?: unknown } | null)?.blocks,
    bodyAr: row.bodyAr,
    bodyEn: row.bodyEn,
  });
  if (!hasTermsText(blocks)) return null;
  return {
    version: row.version,
    bodyAr: row.bodyAr,
    bodyEn: row.bodyEn,
    blocks,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const LETTERHEAD_CODE = `booking_terms:letterhead:${ORGANIZATION_SCOPE}`;

/** Company identity printed on the terms; falls back to the organization's display names. */
async function organizationLetterhead(transaction: Tx, organizationId: string) {
  const org = await transaction.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
    columns: { displayNameAr: true, displayNameEn: true, legalName: true },
  });
  return emptyLetterhead(
    org?.displayNameAr ?? org?.legalName ?? '',
    org?.displayNameEn ?? org?.legalName ?? '',
  );
}

export async function readTermsLetterhead(
  transaction: Tx,
  organizationId: string,
): Promise<TermsLetterhead> {
  const fallback = await organizationLetterhead(transaction, organizationId);
  const row = await transaction.query.stayPolicies.findFirst({
    where: and(
      eq(stayPolicies.organizationId, organizationId),
      eq(stayPolicies.kind, POLICY_KIND),
      eq(stayPolicies.code, LETTERHEAD_CODE),
      eq(stayPolicies.status, 'active'),
    ),
    orderBy: [desc(stayPolicies.version)],
  });
  return sanitizeLetterhead(
    (row?.rulesJson as { letterhead?: unknown } | null)?.letterhead,
    fallback,
  );
}

export async function saveTermsLetterhead(
  claims: SessionClaims,
  input: TermsLetterhead,
): Promise<{ ok: true; letterhead: TermsLetterhead }> {
  const organizationId = claims.organizationId;
  if (!organizationId) throw new Error('organization_required');
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await applyOwnerScope(transaction, {
      organizationId,
      userId: claims.sub,
      partyId: claims.partyId,
      roles: claims.roles,
    });
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:${LETTERHEAD_CODE}`}))`,
    );
    const letterhead = sanitizeLetterhead(
      input,
      await organizationLetterhead(transaction, organizationId),
    );

    await transaction
      .update(stayPolicies)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(
        and(
          eq(stayPolicies.organizationId, organizationId),
          eq(stayPolicies.kind, POLICY_KIND),
          eq(stayPolicies.code, LETTERHEAD_CODE),
          eq(stayPolicies.status, 'active'),
        ),
      );
    const [latest] = await transaction
      .select({ version: sql<number>`coalesce(max(${stayPolicies.version}), 0)::int` })
      .from(stayPolicies)
      .where(
        and(
          eq(stayPolicies.organizationId, organizationId),
          eq(stayPolicies.kind, POLICY_KIND),
          eq(stayPolicies.code, LETTERHEAD_CODE),
        ),
      );
    await transaction.insert(stayPolicies).values({
      organizationId,
      kind: POLICY_KIND,
      code: LETTERHEAD_CODE,
      nameAr: 'ترويسة طباعة الشروط والأحكام',
      nameEn: 'Terms print letterhead',
      version: (latest?.version ?? 0) + 1,
      bodyAr: [letterhead.nameAr, letterhead.addressAr].filter(Boolean).join('\n') || null,
      bodyEn: [letterhead.nameEn, letterhead.addressEn].filter(Boolean).join('\n') || null,
      rulesJson: { scope: 'booking_terms_letterhead', letterhead, updatedByUserId: claims.sub },
      status: 'active',
    });
    return { ok: true as const, letterhead };
  });
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
  letterhead: TermsLetterhead;
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
      letterhead: await readTermsLetterhead(transaction, scope.organizationId),
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
  letterhead: TermsLetterhead;
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
      letterhead: await readTermsLetterhead(transaction, scope.organizationId),
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
 * No blocks archive the text: a property falls back to the template, the template to platform defaults.
 */
export async function saveOwnerBookingTerms(
  claims: SessionClaims,
  propertyId: string | null,
  mode: BookingTermsMode,
  input: { blocks: TermsBlock[] },
): Promise<{ ok: true; terms: OwnerBookingTerms | null }> {
  const organizationId = claims.organizationId;
  if (!organizationId) throw new Error('organization_required');
  const blocks = sanitizeTermsBlocks(input.blocks);
  const { bodyAr, bodyEn } = termsBodiesFromBlocks(blocks);
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

    if (!hasTermsText(blocks)) return { ok: true as const, terms: null };

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
          blocks,
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
            blocks,
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
      const letterhead = unit ? await readTermsLetterhead(transaction, unit.organizationId) : null;
      const result: Partial<Record<BookingTermsMode, BookingTermsForCheckout>> = {};
      for (const mode of modes) {
        const terms = unit
          ? toCheckout(
              await resolveBookingTerms(transaction, unit.organizationId, unit.propertyId, mode),
            )
          : checkoutTermsFromOwner(null);
        result[mode] = { ...terms, letterhead };
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
