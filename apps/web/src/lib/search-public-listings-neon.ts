import 'server-only';
import { and, desc, eq, ne, or, sql } from 'drizzle-orm';
import {
  addresses,
  createDatabase,
  listings,
  properties,
  units,
  type Database,
} from '@bhd-r/db';
import type { ListingCollection, PublicListing } from '@bhd-r/contracts';
import { marketStatusFromPurpose, type CatalogueListing } from '@/lib/listing-market-status';
import { healPublicCatalogueListings } from '@/lib/heal-public-listings';

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

/**
 * Public catalogue from Neon.
 * Driven by units.publishWhenAvailable (not only listings.enabled).
 */
export async function searchPublicListingsFromNeon(
  input: PublicListingSearchInput = {},
): Promise<ListingCollection & { data: CatalogueListing[] }> {
  const limit = Math.min(Math.max(input.limit ?? 24, 1), 48);
  await healPublicCatalogueListings().catch(() => undefined);

  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);

    const conditions = [
      eq(units.publishWhenAvailable, true),
      ne(properties.status, 'archived'),
      or(eq(units.status, 'active'), eq(units.status, 'draft'), eq(units.status, 'inactive')),
    ];
    if (input.countryCode) {
      const code = input.countryCode.toUpperCase();
      const alt = code === 'OM' ? 'OMN' : code === 'OMN' ? 'OM' : code;
      conditions.push(
        sql`(upper(${addresses.countryCode}) = ${code} or upper(${addresses.countryCode}) = ${alt})`,
      );
    }
    if (input.governorate) {
      conditions.push(
        sql`(
          ${addresses.governorate} = ${input.governorate}
          or ${addresses.governorate} ilike ${`%${input.governorate}%`}
        )`,
      );
    }
    if (input.category) conditions.push(eq(properties.category, input.category));
    if (input.bedrooms !== undefined) conditions.push(eq(units.bedrooms, input.bedrooms));
    if (input.currency) conditions.push(eq(units.currency, input.currency));

    const rows = await transaction
      .select({
        listingId: listings.id,
        slug: listings.slug,
        publishedAt: listings.publishedAt,
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
        unitUpdatedAt: units.updatedAt,
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
        occupancy: sql<string>`(
          case
            when exists (
              select 1 from sales_deals sd
              where sd.unit_id = ${units.id} and sd.status = 'closed_won'
            ) then 'sold'
            when exists (
              select 1 from leases l
              where l.unit_id = ${units.id}
                and l.status in ('draft', 'active', 'cancel_requested', 'clearance_pending')
            ) then 'leased'
            when exists (
              select 1 from holds h
              where h.unit_id = ${units.id} and h.status = 'active' and h.expires_at > now()
            ) or exists (
              select 1 from reservations r
              where r.unit_id = ${units.id}
                and r.status in ('pending', 'confirmed')
                and r.expires_at > now()
            ) then 'reserved'
            else 'available'
          end
        )`,
      })
      .from(units)
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .innerJoin(addresses, eq(addresses.id, properties.addressId))
      .leftJoin(listings, eq(listings.unitId, units.id))
      .where(and(...conditions))
      .orderBy(desc(listings.publishedAt), desc(units.updatedAt), desc(units.id))
      .limit(limit);

    const data: CatalogueListing[] = rows.map((row) => {
      const purpose = row.listingPurpose as PublicListing['listingPurpose'];
      const occupancy = row.occupancy;
      const marketStatus =
        occupancy === 'sold' || occupancy === 'leased' || occupancy === 'reserved'
          ? occupancy
          : marketStatusFromPurpose(purpose);
      return {
        id: row.listingId ?? row.unitId,
        slug: row.slug ?? row.unitId,
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
        listingPurpose: purpose,
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
        coverImageUrl: row.coverAssetId ? `/api/public/media/${row.coverAssetId}` : null,
        available: true as const,
        publishedAt: (row.publishedAt ?? row.unitUpdatedAt ?? new Date()).toISOString(),
        marketStatus,
      };
    });

    return { data, pagination: { nextCursor: null, hasMore: false } };
  });
}
