import 'server-only';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  addresses,
  createDatabase,
  listings,
  properties,
  units,
  type Database,
} from '@bhd-r/db';
import type { ListingCollection, PublicListing } from '@bhd-r/contracts';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRPublicListingsDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRPublicListingsDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRPublicListingsDb = { db };
  }
  return globalForDb.__bhdRPublicListingsDb;
}

export type PublicListingSearchInput = {
  countryCode?: string;
  governorate?: string;
  category?: PublicListing['category'];
  bedrooms?: number;
  currency?: PublicListing['rent']['currency'];
  limit?: number;
};

const PROPERTY_CATEGORIES = new Set<PublicListing['category']>([
  'apartment',
  'villa',
  'building',
  'office',
  'shop',
  'warehouse',
  'land',
  'other',
]);

export function asPublicListingCategory(
  value: string | undefined | null,
): PublicListing['category'] | undefined {
  if (!value) return undefined;
  return PROPERTY_CATEGORIES.has(value as PublicListing['category'])
    ? (value as PublicListing['category'])
    : undefined;
}

/** Public catalogue from Neon (same rules as Nest /v1/public/listings). */
export async function searchPublicListingsFromNeon(
  input: PublicListingSearchInput = {},
): Promise<ListingCollection> {
  const limit = Math.min(Math.max(input.limit ?? 24, 1), 48);
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.public', 'true', true)`);
    await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);

    const conditions = [
      eq(listings.enabled, true),
      isNotNull(listings.publishedAt),
      eq(units.publishWhenAvailable, true),
      eq(units.status, 'active'),
      eq(properties.status, 'active'),
    ];
    if (input.countryCode) conditions.push(eq(addresses.countryCode, input.countryCode));
    if (input.governorate) conditions.push(eq(addresses.governorate, input.governorate));
    if (input.category) conditions.push(eq(properties.category, input.category));
    if (input.bedrooms !== undefined) conditions.push(eq(units.bedrooms, input.bedrooms));
    if (input.currency) conditions.push(eq(units.currency, input.currency));

    const rows = await transaction
      .select({
        id: listings.id,
        slug: listings.slug,
        propertyId: properties.id,
        unitId: units.id,
        category: properties.category,
        unitNameAr: units.nameAr,
        unitNameEn: units.nameEn,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        bedrooms: units.bedrooms,
        bathrooms: units.bathrooms,
        areaSquareMeters: units.areaSquareMeters,
        listingPurpose: units.listingPurpose,
        rentMinor: units.rentMinor,
        salePriceMinor: units.salePriceMinor,
        currency: units.currency,
        governorate: addresses.governorate,
        wilayat: addresses.wilayat,
        publishedAt: listings.publishedAt,
        coverAssetId: sql<string | null>`(
          select ma.id::text
          from unit_media um
          join media_assets ma on ma.id = um.media_asset_id
          where um.unit_id = ${units.id}
            and ma.processing_status = 'ready'
            and ma.scan_status = 'clean'
            and ma.mime_type like 'image/%'
          order by um.position asc
          limit 1
        )`,
      })
      .from(listings)
      .innerJoin(units, eq(units.id, listings.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .innerJoin(addresses, eq(addresses.id, properties.addressId))
      .where(and(...conditions))
      .orderBy(desc(listings.publishedAt), desc(units.id))
      .limit(limit);

    const data: PublicListing[] = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      propertyId: row.propertyId,
      unitId: row.unitId,
      category: row.category as PublicListing['category'],
      propertyNameAr: row.propertyNameAr,
      propertyNameEn: row.propertyNameEn,
      unitNameAr: row.unitNameAr,
      unitNameEn: row.unitNameEn,
      governorate: row.governorate,
      wilayat: row.wilayat,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      areaSquareMeters:
        row.areaSquareMeters === null || row.areaSquareMeters === undefined
          ? null
          : String(row.areaSquareMeters),
      listingPurpose: row.listingPurpose as PublicListing['listingPurpose'],
      rent: {
        amountMinor: row.rentMinor.toString(),
        currency: row.currency as PublicListing['rent']['currency'],
      },
      salePrice: row.salePriceMinor
        ? {
            amountMinor: row.salePriceMinor.toString(),
            currency: row.currency as PublicListing['rent']['currency'],
          }
        : null,
      // Relative path so Next/Image optimizer accepts it (absolute same-origin URLs are rejected).
      coverImageUrl: row.coverAssetId ? `/api/public/media/${row.coverAssetId}` : null,
      available: true as const,
      publishedAt: (row.publishedAt ?? new Date()).toISOString(),
    }));

    return { data, pagination: { nextCursor: null, hasMore: false } };
  });
}
