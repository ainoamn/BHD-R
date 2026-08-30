import 'server-only';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@bhd-r/db';
import type { ListingCollection, PublicListing } from '@bhd-r/contracts';
import { marketStatusFromPurpose, type CatalogueListing } from '@/lib/listing-market-status';

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

type CatalogueRow = {
  listing_id: string | null;
  slug: string | null;
  published_at: Date | string | null;
  property_id: string;
  unit_id: string;
  category: string;
  unit_name_ar: string;
  unit_name_en: string;
  property_name_ar: string;
  property_name_en: string;
  bedrooms: number;
  bathrooms: number;
  area_square_meters: string | null;
  listing_purpose: string;
  rent_minor: string | number | bigint;
  sale_price_minor: string | number | bigint | null;
  currency: string;
  governorate: string | null;
  wilayat: string | null;
  unit_updated_at: Date | string | null;
  cover_asset_id: string | null;
  occupancy: string;
};

/**
 * Public catalogue from Neon — raw SQL + privileged session.
 * Driven by units.publish_when_available so stale listing rows cannot hide units.
 */
export async function searchPublicListingsFromNeon(
  input: PublicListingSearchInput = {},
): Promise<ListingCollection & { data: CatalogueListing[] }> {
  const limit = Math.min(Math.max(input.limit ?? 24, 1), 48);
  const { db } = getDatabase();

  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);

    // Heal publish flags in the same privileged transaction.
    await transaction.execute(sql`
      update properties p
      set status = 'active', updated_at = now()
      from units u
      where u.property_id = p.id
        and u.publish_when_available = true
        and p.status in ('draft', 'inactive')
    `);
    await transaction.execute(sql`
      update units
      set status = 'active', updated_at = now()
      where publish_when_available = true
        and status in ('draft', 'inactive')
    `);
    await transaction.execute(sql`
      update listings l
      set
        enabled = true,
        published_at = coalesce(l.published_at, now()),
        updated_at = now()
      from units u
      where l.unit_id = u.id
        and u.publish_when_available = true
        and (l.enabled = false or l.published_at is null)
    `);
    await transaction.execute(sql`
      insert into listings (id, organization_id, unit_id, slug, enabled, published_at, created_at, updated_at)
      select
        gen_random_uuid(),
        u.organization_id,
        u.id,
        lower(
          regexp_replace(
            coalesce(nullif(p.name_en, ''), 'unit')
              || '-'
              || coalesce(nullif(u.code, ''), 'u')
              || '-'
              || replace(u.id::text, '-', ''),
            '[^a-z0-9]+',
            '-',
            'g'
          )
        ),
        true,
        now(),
        now(),
        now()
      from units u
      join properties p on p.id = u.property_id
      where u.publish_when_available = true
        and p.status <> 'archived'
        and not exists (select 1 from listings l where l.unit_id = u.id)
      on conflict (unit_id) do nothing
    `);
    // Expire holds that already timed out so Nest/public paths stay aligned.
    await transaction.execute(sql`
      update holds
      set status = 'expired', updated_at = now()
      where status = 'active' and expires_at <= now()
    `);

    const country = input.countryCode?.trim().toUpperCase() || null;
    const countryAlt = country === 'OM' ? 'OMN' : country === 'OMN' ? 'OM' : country;
    const governorate = input.governorate?.trim() || null;
    const category = input.category ?? null;
    const bedrooms = input.bedrooms ?? null;
    const currency = input.currency ?? null;

    const result = await transaction.execute(sql`
      select
        l.id::text as listing_id,
        l.slug as slug,
        l.published_at as published_at,
        p.id::text as property_id,
        u.id::text as unit_id,
        p.category::text as category,
        u.name_ar as unit_name_ar,
        u.name_en as unit_name_en,
        p.name_ar as property_name_ar,
        p.name_en as property_name_en,
        u.bedrooms as bedrooms,
        u.bathrooms as bathrooms,
        u.area_square_meters as area_square_meters,
        u.listing_purpose as listing_purpose,
        u.rent_minor::text as rent_minor,
        u.sale_price_minor::text as sale_price_minor,
        u.currency as currency,
        a.governorate as governorate,
        a.wilayat as wilayat,
        u.updated_at as unit_updated_at,
        (
          select ma.id::text
          from unit_media um
          join media_assets ma on ma.id = um.media_asset_id
          where um.unit_id = u.id
            and ma.processing_status = 'ready'
            and ma.scan_status = 'clean'
            and ma.mime_type like 'image/%'
          order by um.position asc
          limit 1
        ) as cover_asset_id,
        case
          when exists (
            select 1 from sales_deals sd
            where sd.unit_id = u.id and sd.status = 'closed_won'
          ) then 'sold'
          when exists (
            select 1 from leases le
            where le.unit_id = u.id
              and le.status in ('draft', 'active', 'cancel_requested', 'clearance_pending')
          ) then 'leased'
          when exists (
            select 1 from holds h
            where h.unit_id = u.id and h.status = 'active' and h.expires_at > now()
          ) or exists (
            select 1 from reservations r
            where r.unit_id = u.id
              and r.status in ('pending', 'confirmed')
              and r.expires_at > now()
          ) then 'reserved'
          else 'available'
        end as occupancy
      from units u
      join properties p on p.id = u.property_id
      join addresses a on a.id = p.address_id
      left join listings l on l.unit_id = u.id
      where u.publish_when_available = true
        and p.status <> 'archived'
        and u.status in ('active', 'draft', 'inactive')
        and (
          ${country}::text is null
          or upper(a.country_code) = ${country}
          or upper(a.country_code) = ${countryAlt}
        )
        and (
          ${governorate}::text is null
          or a.governorate = ${governorate}
          or a.governorate ilike ('%' || ${governorate} || '%')
        )
        and (
          ${category}::text is null
          or p.category::text = ${category}
        )
        and (
          ${bedrooms}::int is null
          or u.bedrooms = ${bedrooms}
        )
        and (
          ${currency}::text is null
          or u.currency = ${currency}
        )
      order by l.published_at desc nulls last, u.updated_at desc, u.id desc
      limit ${limit}
    `);

    const rawUnknown = result as unknown;
    const rows: CatalogueRow[] = Array.isArray(rawUnknown)
      ? (rawUnknown as CatalogueRow[])
      : Array.isArray((rawUnknown as { rows?: CatalogueRow[] }).rows)
        ? ((rawUnknown as { rows: CatalogueRow[] }).rows)
        : [];

    const data: CatalogueListing[] = rows.map((row) => {
      const purpose = row.listing_purpose as PublicListing['listingPurpose'];
      const occupancy = row.occupancy;
      const marketStatus =
        occupancy === 'sold' || occupancy === 'leased' || occupancy === 'reserved'
          ? occupancy
          : marketStatusFromPurpose(purpose);
      const publishedAt =
        row.published_at instanceof Date
          ? row.published_at
          : row.published_at
            ? new Date(row.published_at)
            : row.unit_updated_at
              ? new Date(row.unit_updated_at)
              : new Date();
      return {
        id: row.listing_id ?? row.unit_id,
        slug: row.slug ?? row.unit_id,
        propertyId: row.property_id,
        unitId: row.unit_id,
        category: row.category as PublicListing['category'],
        propertyNameAr: row.property_name_ar,
        propertyNameEn: row.property_name_en,
        unitNameAr: row.unit_name_ar,
        unitNameEn: row.unit_name_en,
        governorate: row.governorate ?? '',
        wilayat: row.wilayat ?? '',
        bedrooms: Number(row.bedrooms) || 0,
        bathrooms: Number(row.bathrooms) || 0,
        areaSquareMeters: row.area_square_meters,
        listingPurpose: purpose,
        rent: {
          amountMinor: String(row.rent_minor ?? '0'),
          currency: row.currency as PublicListing['rent']['currency'],
        },
        salePrice: row.sale_price_minor
          ? {
              amountMinor: String(row.sale_price_minor),
              currency: row.currency as PublicListing['rent']['currency'],
            }
          : null,
        coverImageUrl: row.cover_asset_id ? `/api/public/media/${row.cover_asset_id}` : null,
        available: true as const,
        publishedAt: publishedAt.toISOString(),
        marketStatus,
      };
    });

    return { data, pagination: { nextCursor: null, hasMore: false } };
  });
}
