import 'server-only';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@bhd-r/db';
import type { ListingCollection, PublicListing } from '@bhd-r/contracts';
import { marketStatusFromPurpose, type CatalogueListing } from '@/lib/listing-market-status';
import { omanLocations } from '@/lib/oman-locations';
import { googleMapsLinkFromCoords, parseGoogleMapsUrl } from '@/lib/parse-google-maps-url';

function mapsUrlFromNotes(notes?: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/https?:\/\/(?:www\.)?(?:google\.[^/\s]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)[^\s)]*/i);
  return match?.[0] ?? null;
}
function locationNameAlts(kind: 'governorate' | 'wilayat', value: string): string[] {
  const needle = value.trim();
  if (!needle) return [];
  if (kind === 'governorate') {
    const hit = omanLocations.find((item) => item.en === needle || item.ar === needle);
    return hit ? [hit.en, hit.ar] : [needle];
  }
  for (const gov of omanLocations) {
    const state = gov.states.find((item) => item.en === needle || item.ar === needle);
    if (state) return [state.en, state.ar];
  }
  return [needle];
}

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
  wilayat?: string;
  village?: string;
  category?: PublicListing['category'];
  /** OR match when multiple categories selected */
  categories?: PublicListing['category'][];
  /** Exact bedroom count (legacy). Prefer bedroomsMin for “at least”. */
  bedrooms?: number;
  bedroomsMin?: number;
  bathroomsMin?: number;
  currency?: PublicListing['rent']['currency'];
  /** rent | sale — includes `both` units in either case */
  purpose?: 'rent' | 'sale';
  /** Major currency units (e.g. OMR), converted to minor (* 1000) for SQL */
  priceMin?: number;
  priceMax?: number;
  hasPool?: boolean;
  hasParking?: boolean;
  /** Amenity codes that must ALL be present on the property */
  amenities?: string[];
  /** Free-text search across property/unit names */
  q?: string;
  /** Exclude a property (similar rails) */
  excludePropertyId?: string;
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
  city: string | null;
  unit_updated_at: Date | string | null;
  cover_asset_id: string | null;
  occupancy: string;
  has_pool: boolean | null;
  parking_spaces: number | null;
  amenity_codes: string[] | null;
  latitude: number | string | null;
  longitude: number | string | null;
  maps_note: string | null;
  organization_id: string;
  owner_party_id: string | null;
  avg_rating: number | string | null;
  review_count: number | string | null;
};

/**
 * Public catalogue from Neon — raw SQL + privileged session.
 * Driven by units.publish_when_available so stale listing rows cannot hide units.
 */
export async function searchPublicListingsFromNeon(
  input: PublicListingSearchInput = {},
): Promise<ListingCollection & { data: CatalogueListing[] }> {
  const limit = Math.min(Math.max(input.limit ?? 24, 1), 100);
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
    // Expire holds/reservations that already timed out so catalogue matches booking.
    await transaction.execute(sql`
      update holds
      set status = 'expired', updated_at = now()
      where status = 'active' and expires_at <= now()
    `);
    await transaction.execute(sql`
      update reservations
      set status = 'expired', updated_at = now()
      where status in ('pending', 'confirmed') and expires_at <= now()
    `);

    // Catalogue SELECT under public RLS — not platform_admin (heal/expire above used admin).
    await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
    await transaction.execute(sql`select set_config('app.public', 'true', true)`);

    const country = input.countryCode?.trim().toUpperCase() || null;
    const countryAlt = country === 'OM' ? 'OMN' : country === 'OMN' ? 'OM' : country;
    const governorate = input.governorate?.trim() || null;
    const wilayat = input.wilayat?.trim() || null;
    const village = input.village?.trim() || null;
    const categories =
      input.categories && input.categories.length > 0
        ? input.categories
        : input.category
          ? [input.category]
          : [];
    const bedroomsExact = input.bedrooms ?? null;
    const bedroomsMin = input.bedroomsMin ?? null;
    const bathroomsMin = input.bathroomsMin ?? null;
    const currency = input.currency ?? null;
    const purpose = input.purpose ?? null;
    const hasPool = input.hasPool === true;
    const hasParking = input.hasParking === true;
    const amenities = (input.amenities ?? []).map((code) => code.trim()).filter(Boolean);
    const q = input.q?.trim() || null;
    const excludePropertyId = input.excludePropertyId?.trim() || null;
    const priceMinMajor =
      input.priceMin !== undefined && Number.isFinite(input.priceMin) ? input.priceMin : null;
    const priceMaxMajor =
      input.priceMax !== undefined && Number.isFinite(input.priceMax) ? input.priceMax : null;
    const priceMinMinor =
      priceMinMajor !== null ? Math.round(Math.max(0, priceMinMajor) * 1000) : null;
    const priceMaxMinor =
      priceMaxMajor !== null ? Math.round(Math.max(0, priceMaxMajor) * 1000) : null;

    const countryClause = country
      ? sql`and (upper(a.country_code) = ${country} or upper(a.country_code) = ${countryAlt})`
      : sql``;
    const governorateClause = (() => {
      if (!governorate) return sql``;
      const alts = locationNameAlts('governorate', governorate);
      if (alts.length >= 2) {
        return sql`and (a.governorate = ${alts[0]} or a.governorate = ${alts[1]} or a.governorate ilike ${`%${alts[0]}%`} or a.governorate ilike ${`%${alts[1]}%`})`;
      }
      return sql`and (a.governorate = ${governorate} or a.governorate ilike ${`%${governorate}%`})`;
    })();
    const wilayatClause = (() => {
      if (!wilayat) return sql``;
      const alts = locationNameAlts('wilayat', wilayat);
      if (alts.length >= 2) {
        return sql`and (a.wilayat = ${alts[0]} or a.wilayat = ${alts[1]} or a.wilayat ilike ${`%${alts[0]}%`} or a.wilayat ilike ${`%${alts[1]}%`})`;
      }
      return sql`and (a.wilayat = ${wilayat} or a.wilayat ilike ${`%${wilayat}%`})`;
    })();
    const villageClause = village
      ? sql`and (a.city = ${village} or a.city ilike ${`%${village}%`} or a.street ilike ${`%${village}%`})`
      : sql``;
    const categoryClause =
      categories.length === 1
        ? sql`and p.category::text = ${categories[0]}`
        : categories.length > 1
          ? sql`and p.category::text in (${sql.join(
              categories.map((c) => sql`${c}`),
              sql`, `,
            )})`
          : sql``;
    const bedroomsClause =
      bedroomsExact !== null
        ? bedroomsExact >= 5
          ? sql`and u.bedrooms >= 5`
          : sql`and u.bedrooms = ${bedroomsExact}`
        : bedroomsMin !== null && bedroomsMin > 0
          ? sql`and u.bedrooms >= ${bedroomsMin}`
          : sql``;
    const bathroomsClause =
      bathroomsMin !== null && bathroomsMin > 0
        ? sql`and u.bathrooms >= ${bathroomsMin}`
        : sql``;
    const currencyClause = currency ? sql`and u.currency = ${currency}` : sql``;
    const purposeClause =
      purpose === 'rent'
        ? sql`and u.listing_purpose in ('rent', 'both')`
        : purpose === 'sale'
          ? sql`and u.listing_purpose in ('sale', 'both')`
          : sql``;
    const priceExpr =
      purpose === 'sale'
        ? sql`coalesce(u.sale_price_minor, 0)`
        : purpose === 'rent'
          ? sql`coalesce(u.rent_minor, 0)`
          : sql`case when u.listing_purpose = 'sale' then coalesce(u.sale_price_minor, 0) else coalesce(u.rent_minor, 0) end`;
    const priceMinClause =
      priceMinMinor !== null ? sql`and ${priceExpr} >= ${priceMinMinor}` : sql``;
    const priceMaxClause =
      priceMaxMinor !== null ? sql`and ${priceExpr} <= ${priceMaxMinor}` : sql``;
    const poolClause = hasPool
      ? sql`and (u.has_pool = true or exists (select 1 from property_amenities pa_pool where pa_pool.property_id = p.id and pa_pool.code = 'pool'))`
      : sql``;
    const parkingClause = hasParking
      ? sql`and (coalesce(pp.parking_spaces, 0) > 0 or exists (select 1 from property_amenities pa_park where pa_park.property_id = p.id and pa_park.code = 'parking'))`
      : sql``;
    const amenitiesClause =
      amenities.length > 0
        ? sql`and (
          select count(distinct pa_req.code)
          from property_amenities pa_req
          where pa_req.property_id = p.id
            and pa_req.code in (${sql.join(
              amenities.map((code) => sql`${code}`),
              sql`, `,
            )})
        ) = ${amenities.length}`
        : sql``;
    const qClause = q
      ? sql`and (
          p.name_ar ilike ${`%${q}%`}
          or p.name_en ilike ${`%${q}%`}
          or u.name_ar ilike ${`%${q}%`}
          or u.name_en ilike ${`%${q}%`}
          or coalesce(a.governorate, '') ilike ${`%${q}%`}
          or coalesce(a.wilayat, '') ilike ${`%${q}%`}
          or coalesce(a.city, '') ilike ${`%${q}%`}
        )`
      : sql``;
    const excludeClause = excludePropertyId
      ? sql`and p.id <> ${excludePropertyId}::uuid`
      : sql``;

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
        a.city as city,
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
            where sd.unit_id = u.id and sd.status::text = 'closed_won'
          ) then 'sold'
          when exists (
            select 1 from leases le
            where le.unit_id = u.id
              and le.status::text in ('draft', 'active', 'cancel_requested', 'clearance_pending')
          ) then 'leased'
          when exists (
            select 1 from holds h
            where h.unit_id = u.id and h.status::text = 'active' and h.expires_at > now()
          ) or exists (
            select 1 from reservations r
            where r.unit_id = u.id
              and r.status::text in ('pending', 'confirmed')
              and r.expires_at > now()
          ) then 'reserved'
          else 'available'
        end as occupancy,
        u.has_pool as has_pool,
        coalesce(pp.parking_spaces, 0) as parking_spaces,
        (
          select coalesce(array_agg(pa.code order by pa.code), '{}'::text[])
          from property_amenities pa
          where pa.property_id = p.id
        ) as amenity_codes,
        case when a.location is not null then ST_Y(a.location::geometry) else null end as latitude,
        case when a.location is not null then ST_X(a.location::geometry) else null end as longitude,
        pp.notes as maps_note,
        p.organization_id::text as organization_id,
        p.owner_party_id::text as owner_party_id,
        (
          select avg(r.rating)::float
          from reviews r
          where r.target_type = 'property'
            and r.target_id = p.id
            and r.status = 'published'
        ) as avg_rating,
        (
          select count(*)::int
          from reviews r
          where r.target_type = 'property'
            and r.target_id = p.id
            and r.status = 'published'
        ) as review_count
      from units u
      join properties p on p.id = u.property_id
      join addresses a on a.id = p.address_id
      left join property_profiles pp on pp.property_id = p.id
      left join listings l on l.unit_id = u.id
      where u.publish_when_available = true
        and p.status <> 'archived'
        and u.status in ('active', 'draft', 'inactive')
        ${countryClause}
        ${governorateClause}
        ${wilayatClause}
        ${villageClause}
        ${categoryClause}
        ${bedroomsClause}
        ${bathroomsClause}
        ${currencyClause}
        ${purposeClause}
        ${priceMinClause}
        ${priceMaxClause}
        ${poolClause}
        ${parkingClause}
        ${amenitiesClause}
        ${qClause}
        ${excludeClause}
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
      let latitude =
        row.latitude !== null && row.latitude !== undefined && Number.isFinite(Number(row.latitude))
          ? Number(row.latitude)
          : null;
      let longitude =
        row.longitude !== null &&
        row.longitude !== undefined &&
        Number.isFinite(Number(row.longitude))
          ? Number(row.longitude)
          : null;
      let mapsUrl = mapsUrlFromNotes(row.maps_note);
      if ((latitude === null || longitude === null) && mapsUrl) {
        const parsed = parseGoogleMapsUrl(mapsUrl);
        if (parsed) {
          latitude = parsed.latitude;
          longitude = parsed.longitude;
        }
      }
      if (!mapsUrl && latitude !== null && longitude !== null) {
        mapsUrl = googleMapsLinkFromCoords(latitude, longitude);
      }
      const avgRating =
        row.avg_rating !== null && row.avg_rating !== undefined && Number.isFinite(Number(row.avg_rating))
          ? Math.round(Number(row.avg_rating) * 10) / 10
          : null;
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
        hasPool: Boolean(row.has_pool),
        parkingSpaces: Number(row.parking_spaces) || 0,
        amenities: Array.isArray(row.amenity_codes) ? row.amenity_codes.filter(Boolean) : [],
        city: row.city ?? '',
        latitude,
        longitude,
        mapsUrl,
        organizationId: row.organization_id,
        ownerPartyId: row.owner_party_id,
        avgRating,
        reviewCount: Number(row.review_count) || 0,
      };
    });

    return { data, pagination: { nextCursor: null, hasMore: false } };
  });
}
