import 'server-only';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import type {
  CreateStayProfilesInput,
  CreateStayUnitTypeInput,
  StaySetupContext,
  UpdateStayProfileInput,
  UpsertStayPublicListingInput,
  UpsertStayRatePlanInput,
} from '@bhd-r/contracts';
import {
  addresses,
  createDatabase,
  outboxEvents,
  properties,
  stayProfiles,
  stayPublicListings,
  stayRatePlans,
  stayUnitTypes,
  units,
  type Database,
} from '@bhd-r/db';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRStaySetupWriteDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRStaySetupWriteDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRStaySetupWriteDb = { db };
  }
  return globalForDb.__bhdRStaySetupWriteDb;
}

async function withinTenant<T>(
  claims: SessionClaims,
  work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.organization_id', ${claims.organizationId ?? ''}, true)`,
    );
    await transaction.execute(sql`select set_config('app.user_id', ${claims.sub}, true)`);
    await transaction.execute(
      sql`select set_config('app.party_id', ${claims.partyId ?? ''}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.platform_admin', ${String(claims.roles.includes('platform_admin'))}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.is_tenant', ${String(claims.roles.includes('tenant'))}, true)`,
    );
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);
    return work(transaction);
  });
}

function assertOrg(claims: SessionClaims): string {
  if (!claims.organizationId) throw new Error('organization_required');
  return claims.organizationId;
}

export type StaySetupPropertySummary = {
  serialNumber: string | null;
  nameAr: string;
  nameEn: string;
  location: string;
  kind: string;
  status: string;
  unitCount: number;
  coverImageUrl: string | null;
};

async function loadPropertyCover(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  organizationId: string,
  propertyId: string,
): Promise<string | null> {
  const coverRaw = await transaction.execute(sql`
    select distinct on (u.property_id)
      u.property_id as "propertyId",
      um.media_asset_id as "mediaAssetId"
    from unit_media um
    inner join units u on u.id = um.unit_id
    inner join media_assets ma on ma.id = um.media_asset_id
    where um.organization_id = ${organizationId}
      and u.property_id = ${propertyId}
    order by
      u.property_id,
      case when ma.metadata->>'galleryScope' = 'building' then 0 else 1 end,
      um.position asc
    limit 1
  `);
  const coverList = (
    Array.isArray(coverRaw) ? coverRaw : ((coverRaw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ mediaAssetId?: string }>;
  const mediaAssetId = coverList[0]?.mediaAssetId;
  return mediaAssetId ? `/api/owner/media/${mediaAssetId}` : null;
}

export async function loadStaySetupContextOnNeon(
  claims: SessionClaims,
  propertyId: string,
): Promise<{ context: StaySetupContext; summary: StaySetupPropertySummary }> {
  const organizationId = assertOrg(claims);
  return withinTenant(claims, async (transaction) => {
    const [property] = await transaction
      .select({
        id: properties.id,
        nameAr: properties.nameAr,
        nameEn: properties.nameEn,
        defaultCurrency: properties.defaultCurrency,
        serialNumber: properties.serialNumber,
        kind: properties.kind,
        status: properties.status,
        governorate: addresses.governorate,
        wilayat: addresses.wilayat,
        city: addresses.city,
        street: addresses.street,
      })
      .from(properties)
      .innerJoin(addresses, eq(addresses.id, properties.addressId))
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
      .limit(1);
    if (!property) throw new Error('property_not_found');

    const unitRows = await transaction
      .select({
        id: units.id,
        code: units.code,
        nameAr: units.nameAr,
        nameEn: units.nameEn,
        bedrooms: units.bedrooms,
        bathrooms: units.bathrooms,
        status: units.status,
      })
      .from(units)
      .where(and(eq(units.propertyId, propertyId), eq(units.organizationId, organizationId)))
      .orderBy(asc(units.code));

    const profileRows =
      unitRows.length === 0
        ? []
        : await transaction
            .select({
              unitId: stayProfiles.unitId,
              id: stayProfiles.id,
              publishStatus: stayProfiles.publishStatus,
            })
            .from(stayProfiles)
            .where(
              and(
                eq(stayProfiles.organizationId, organizationId),
                inArray(
                  stayProfiles.unitId,
                  unitRows.map((row) => row.id),
                ),
              ),
            );

    const profileByUnit = new Map(profileRows.map((row) => [row.unitId, row]));

    const unitTypeRows = await transaction
      .select({
        id: stayUnitTypes.id,
        code: stayUnitTypes.code,
        nameAr: stayUnitTypes.nameAr,
        nameEn: stayUnitTypes.nameEn,
        maxGuests: stayUnitTypes.maxGuests,
      })
      .from(stayUnitTypes)
      .where(
        and(
          eq(stayUnitTypes.propertyId, propertyId),
          eq(stayUnitTypes.organizationId, organizationId),
        ),
      )
      .orderBy(asc(stayUnitTypes.code));

    const listingRows = await transaction
      .select({
        id: stayPublicListings.id,
        unitTypeId: stayPublicListings.unitTypeId,
        slug: stayPublicListings.slug,
        titleAr: stayPublicListings.titleAr,
        titleEn: stayPublicListings.titleEn,
        enabled: stayPublicListings.enabled,
        publishedAt: stayPublicListings.publishedAt,
      })
      .from(stayPublicListings)
      .where(
        and(
          eq(stayPublicListings.propertyId, propertyId),
          eq(stayPublicListings.organizationId, organizationId),
        ),
      );

    const coverImageUrl = await loadPropertyCover(transaction, organizationId, propertyId);

    return {
      context: {
        propertyId: property.id,
        propertyNameAr: property.nameAr,
        propertyNameEn: property.nameEn,
        defaultCurrency: property.defaultCurrency,
        units: unitRows.map((unit) => {
          const profile = profileByUnit.get(unit.id);
          return {
            id: unit.id,
            code: unit.code,
            nameAr: unit.nameAr,
            nameEn: unit.nameEn,
            bedrooms: unit.bedrooms,
            bathrooms: unit.bathrooms,
            profileId: profile?.id ?? null,
            publishStatus:
              (profile?.publishStatus as StaySetupContext['units'][number]['publishStatus']) ??
              null,
          };
        }),
        unitTypes: unitTypeRows,
        listings: listingRows.map((listing) => ({
          id: listing.id,
          unitTypeId: listing.unitTypeId,
          slug: listing.slug,
          titleAr: listing.titleAr,
          titleEn: listing.titleEn,
          enabled: listing.enabled,
          publishedAt: listing.publishedAt?.toISOString() ?? null,
        })),
      },
      summary: {
        serialNumber: property.serialNumber,
        nameAr: property.nameAr,
        nameEn: property.nameEn,
        location: [property.street, property.city, property.wilayat, property.governorate]
          .filter(Boolean)
          .join(' · '),
        kind: property.kind,
        status: property.status,
        unitCount: unitRows.length,
        coverImageUrl,
      },
    };
  });
}

async function assertProperty(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  organizationId: string,
  propertyId: string,
) {
  const [property] = await transaction
    .select({
      id: properties.id,
      defaultCurrency: properties.defaultCurrency,
    })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
    .limit(1);
  if (!property) throw new Error('property_not_found');
  return property;
}

export async function createStayUnitTypeOnNeon(
  claims: SessionClaims,
  input: CreateStayUnitTypeInput,
) {
  const organizationId = assertOrg(claims);
  return withinTenant(claims, async (transaction) => {
    await assertProperty(transaction, organizationId, input.propertyId);
    const [created] = await transaction
      .insert(stayUnitTypes)
      .values({
        organizationId,
        propertyId: input.propertyId,
        code: input.code,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        maxAdults: input.maxAdults,
        maxChildren: input.maxChildren,
        maxGuests: input.maxGuests,
        bedrooms: input.bedrooms,
        beds: input.beds,
        bathrooms: input.bathrooms,
        status: 'active',
      })
      .returning();
    return created;
  });
}

export async function createStayProfilesOnNeon(
  claims: SessionClaims,
  input: CreateStayProfilesInput,
) {
  const organizationId = assertOrg(claims);
  return withinTenant(claims, async (transaction) => {
    const property = await assertProperty(transaction, organizationId, input.propertyId);

    const [unitType] = await transaction
      .select({ id: stayUnitTypes.id, maxGuests: stayUnitTypes.maxGuests })
      .from(stayUnitTypes)
      .where(
        and(
          eq(stayUnitTypes.id, input.unitTypeId),
          eq(stayUnitTypes.organizationId, organizationId),
          eq(stayUnitTypes.propertyId, input.propertyId),
        ),
      )
      .limit(1);
    if (!unitType) throw new Error('stay_unit_type_not_found');

    const unitRows = await transaction
      .select({ id: units.id })
      .from(units)
      .where(
        and(
          eq(units.organizationId, organizationId),
          eq(units.propertyId, input.propertyId),
          inArray(units.id, input.unitIds),
        ),
      );
    if (unitRows.length !== input.unitIds.length) {
      throw new Error('invalid_units_for_property');
    }

    const currency = input.currency ?? property.defaultCurrency;
    const maxGuests = input.maxGuests ?? unitType.maxGuests;
    const maxAdults = input.maxAdults ?? Math.min(maxGuests, 2);
    const maxChildren = input.maxChildren ?? 0;
    const now = new Date();
    const created: Array<{ id: string; unitId: string }> = [];

    for (const unitId of input.unitIds) {
      const [existing] = await transaction
        .select({ id: stayProfiles.id })
        .from(stayProfiles)
        .where(and(eq(stayProfiles.organizationId, organizationId), eq(stayProfiles.unitId, unitId)))
        .limit(1);

      if (existing) {
        const [updated] = await transaction
          .update(stayProfiles)
          .set({
            unitTypeId: input.unitTypeId,
            maxAdults,
            maxChildren,
            maxGuests,
            minNights: input.minNights,
            maxNights: input.maxNights,
            instantBook: input.instantBook,
            currency,
            checkInFrom: input.checkInFrom ?? null,
            checkInUntil: input.checkInUntil ?? null,
            checkOutUntil: input.checkOutUntil ?? null,
            updatedAt: now,
          })
          .where(eq(stayProfiles.id, existing.id))
          .returning({ id: stayProfiles.id, unitId: stayProfiles.unitId });
        if (updated) created.push(updated);
        continue;
      }

      const [inserted] = await transaction
        .insert(stayProfiles)
        .values({
          organizationId,
          unitId,
          unitTypeId: input.unitTypeId,
          enabled: false,
          publishStatus: 'draft',
          instantBook: input.instantBook,
          currency,
          minorUnit: currency === 'OMR' || currency === 'BHD' || currency === 'KWD' ? 3 : 2,
          maxAdults,
          maxChildren,
          maxGuests,
          minNights: input.minNights,
          maxNights: input.maxNights,
          checkInFrom: input.checkInFrom ?? '15:00',
          checkInUntil: input.checkInUntil ?? '22:00',
          checkOutUntil: input.checkOutUntil ?? '11:00',
        })
        .returning({ id: stayProfiles.id, unitId: stayProfiles.unitId });
      if (inserted) created.push(inserted);
    }

    return { profiles: created };
  });
}

export async function updateStayProfileOnNeon(
  claims: SessionClaims,
  profileId: string,
  input: UpdateStayProfileInput,
) {
  const organizationId = assertOrg(claims);
  return withinTenant(claims, async (transaction) => {
    const [profile] = await transaction
      .select({ id: stayProfiles.id })
      .from(stayProfiles)
      .where(and(eq(stayProfiles.id, profileId), eq(stayProfiles.organizationId, organizationId)))
      .limit(1);
    if (!profile) throw new Error('stay_profile_not_found');

    const [updated] = await transaction
      .update(stayProfiles)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(stayProfiles.id, profileId))
      .returning();
    return updated;
  });
}

export async function upsertStayRatePlanOnNeon(
  claims: SessionClaims,
  profileId: string,
  input: UpsertStayRatePlanInput,
) {
  const organizationId = assertOrg(claims);
  return withinTenant(claims, async (transaction) => {
    const [profile] = await transaction
      .select({ id: stayProfiles.id, currency: stayProfiles.currency })
      .from(stayProfiles)
      .where(and(eq(stayProfiles.id, profileId), eq(stayProfiles.organizationId, organizationId)))
      .limit(1);
    if (!profile) throw new Error('stay_profile_not_found');
    if (profile.currency !== input.currency) {
      throw new Error('rate_plan_currency_mismatch');
    }

    const [existing] = await transaction
      .select({ id: stayRatePlans.id })
      .from(stayRatePlans)
      .where(
        and(
          eq(stayRatePlans.organizationId, organizationId),
          eq(stayRatePlans.stayProfileId, profileId),
          eq(stayRatePlans.code, 'base'),
        ),
      )
      .limit(1);

    const values = {
      organizationId,
      stayProfileId: profileId,
      code: 'base',
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      currency: input.currency,
      baseNightlyMinor: BigInt(input.baseNightlyMinor),
      weekendNightlyMinor: input.weekendNightlyMinor ? BigInt(input.weekendNightlyMinor) : null,
      refundable: input.refundable,
      enabled: true,
      priority: 100,
      updatedAt: new Date(),
    };

    if (existing) {
      const [updated] = await transaction
        .update(stayRatePlans)
        .set(values)
        .where(eq(stayRatePlans.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await transaction.insert(stayRatePlans).values(values).returning();
    return created;
  });
}

export async function upsertStayListingOnNeon(
  claims: SessionClaims,
  input: UpsertStayPublicListingInput,
) {
  const organizationId = assertOrg(claims);
  return withinTenant(claims, async (transaction) => {
    await assertProperty(transaction, organizationId, input.propertyId);

    const [unitType] = await transaction
      .select({ id: stayUnitTypes.id })
      .from(stayUnitTypes)
      .where(
        and(
          eq(stayUnitTypes.id, input.unitTypeId),
          eq(stayUnitTypes.organizationId, organizationId),
          eq(stayUnitTypes.propertyId, input.propertyId),
        ),
      )
      .limit(1);
    if (!unitType) throw new Error('stay_unit_type_not_found');

    const [existing] = await transaction
      .select({ id: stayPublicListings.id, slug: stayPublicListings.slug })
      .from(stayPublicListings)
      .where(
        and(
          eq(stayPublicListings.organizationId, organizationId),
          eq(stayPublicListings.propertyId, input.propertyId),
          eq(stayPublicListings.unitTypeId, input.unitTypeId),
        ),
      )
      .limit(1);

    const values = {
      organizationId,
      propertyId: input.propertyId,
      unitTypeId: input.unitTypeId,
      slug: input.slug,
      titleAr: input.titleAr,
      titleEn: input.titleEn,
      summaryAr: input.summaryAr ?? null,
      summaryEn: input.summaryEn ?? null,
      enabled: false,
      updatedAt: new Date(),
    };

    if (existing) {
      const [updated] = await transaction
        .update(stayPublicListings)
        .set({
          titleAr: values.titleAr,
          titleEn: values.titleEn,
          summaryAr: values.summaryAr,
          summaryEn: values.summaryEn,
          slug: existing.slug === input.slug ? existing.slug : input.slug,
          updatedAt: values.updatedAt,
        })
        .where(eq(stayPublicListings.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await transaction.insert(stayPublicListings).values(values).returning();
    return created;
  });
}

export async function publishStayProfileOnNeon(claims: SessionClaims, profileId: string) {
  const organizationId = assertOrg(claims);
  return withinTenant(claims, async (transaction) => {
    const [profile] = await transaction
      .select({
        id: stayProfiles.id,
        unitId: stayProfiles.unitId,
        unitTypeId: stayProfiles.unitTypeId,
      })
      .from(stayProfiles)
      .where(and(eq(stayProfiles.id, profileId), eq(stayProfiles.organizationId, organizationId)))
      .limit(1);
    if (!profile) throw new Error('stay_profile_not_found');

    const [ratePlan] = await transaction
      .select({ id: stayRatePlans.id })
      .from(stayRatePlans)
      .where(
        and(
          eq(stayRatePlans.organizationId, organizationId),
          eq(stayRatePlans.stayProfileId, profileId),
          eq(stayRatePlans.enabled, true),
        ),
      )
      .limit(1);
    if (!ratePlan) throw new Error('rate_plan_required_before_publish');

    const [unit] = await transaction
      .select({ propertyId: units.propertyId })
      .from(units)
      .where(and(eq(units.id, profile.unitId), eq(units.organizationId, organizationId)))
      .limit(1);
    if (!unit) throw new Error('unit_not_found');

    const [listing] = await transaction
      .select({ id: stayPublicListings.id })
      .from(stayPublicListings)
      .where(
        and(
          eq(stayPublicListings.organizationId, organizationId),
          eq(stayPublicListings.propertyId, unit.propertyId),
          eq(stayPublicListings.unitTypeId, profile.unitTypeId),
        ),
      )
      .limit(1);
    if (!listing) throw new Error('listing_required_before_publish');

    const now = new Date();

    await transaction
      .update(stayProfiles)
      .set({
        enabled: true,
        publishStatus: 'published',
        updatedAt: now,
      })
      .where(eq(stayProfiles.id, profileId));

    await transaction
      .update(stayPublicListings)
      .set({
        enabled: true,
        publishedAt: now,
        updatedAt: now,
      })
      .where(eq(stayPublicListings.id, listing.id));

    await transaction.insert(outboxEvents).values({
      organizationId,
      topic: 'stay.inventory.changed',
      aggregateType: 'stay_profile',
      aggregateId: profileId,
      payload: { unitId: profile.unitId, reason: 'published' },
    });

    return { id: profileId, unitId: profile.unitId, publishStatus: 'published' as const };
  });
}
