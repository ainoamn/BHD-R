import 'server-only';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@bhd-r/db';
import type { PublicListing } from '@bhd-r/contracts';
import { omanLocations } from '@/lib/oman-locations';
import { googleMapsLinkFromCoords, parseGoogleMapsUrl } from '@/lib/parse-google-maps-url';
import {
  assignUnitSerials,
  inferUnitKind,
  unitKindToCategory,
} from '@/lib/unit-identity';
import type { StayCatalogueCollection, StayCatalogueListing } from '@/lib/stays-catalogue-listing';
import { asPublicListingCategory } from '@/lib/search-public-listings-neon';

function mapsUrlFromNotes(notes?: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(
    /https?:\/\/(?:www\.)?(?:google\.[^/\s]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)[^\s)]*/i,
  );
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
const globalForDb = globalThis as unknown as { __bhdRStaysCatalogueDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRStaysCatalogueDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRStaysCatalogueDb = { db };
  }
  return globalForDb.__bhdRStaysCatalogueDb;
}

export type StayCatalogueSearchInput = {
  countryCode?: string;
  governorate?: string;
  wilayat?: string;
  village?: string;
  category?: PublicListing['category'];
  categories?: PublicListing['category'][];
  bedroomsMin?: number;
  bathroomsMin?: number;
  currency?: string;
  /** Major currency units (e.g. OMR nightly), converted to minor (* 1000) for SQL */
  priceMin?: number;
  priceMax?: number;
  hasPool?: boolean;
  hasParking?: boolean;
  amenities?: string[];
  q?: string;
  limit?: number;
};

type StayCatalogueRow = {
  slug: string;
  published_at: Date | string | null;
  property_id: string;
  unit_id: string;
  unit_code: string | null;
  property_kind: string | null;
  property_serial: string | null;
  category: string;
  unit_name_ar: string;
  unit_name_en: string;
  property_name_ar: string;
  property_name_en: string;
  bedrooms: number;
  bathrooms: number;
  area_square_meters: string | null;
  max_guests: number;
  nightly_minor: string | null;
  currency: string;
  governorate: string | null;
  wilayat: string | null;
  city: string | null;
  area: string | null;
  street: string | null;
  profile_updated_at: Date | string | null;
  unit_cover_asset_id: string | null;
  building_cover_asset_id: string | null;
  cover_asset_id: string | null;
  has_pool: boolean | null;
  parking_spaces: number | null;
  amenity_codes: string[] | null;
  latitude: number | string | null;
  longitude: number | string | null;
  maps_note: string | null;
};

function unitCategoryMatch(cat: PublicListing['category']) {
  if (cat === 'shop') {
    return sql`(u.code ilike 'S-%' or u.name_ar ilike '%محل%' or u.name_en ilike '%shop%')`;
  }
  if (cat === 'apartment') {
    return sql`(u.code ilike 'A-%' or u.name_ar ilike '%شقة%' or u.name_en ilike '%apartment%')`;
  }
  if (cat === 'office') {
    return sql`(u.code ilike 'R-%' or u.name_ar ilike '%معرض%' or u.name_en ilike '%showroom%')`;
  }
  return sql`false`;
}

/** Public stay catalogue — one row per published stay profile (unit). */
export async function searchStaysCatalogueFromNeon(
  input: StayCatalogueSearchInput = {},
): Promise<StayCatalogueCollection> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 100);
  const { db } = getDatabase();

  return db.transaction(async (transaction) => {
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
    const bedroomsMin = input.bedroomsMin ?? null;
    const bathroomsMin = input.bathroomsMin ?? null;
    const currency = input.currency ?? null;
    const hasPool = input.hasPool === true;
    const hasParking = input.hasParking === true;
    const amenities = (input.amenities ?? []).map((code) => code.trim()).filter(Boolean);
    const q = input.q?.trim() || null;
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
        ? sql`and (
            p.category::text = ${categories[0]}
            or (p.kind = 'multi_unit' and ${unitCategoryMatch(categories[0]!)})
          )`
        : categories.length > 1
          ? sql`and (
              p.category::text in (${sql.join(
                categories.map((c) => sql`${c}`),
                sql`, `,
              )})
              or (
                p.kind = 'multi_unit' and (
                  ${sql.join(
                    categories.map((c) => unitCategoryMatch(c)),
                    sql` or `,
                  )}
                )
              )
            )`
          : sql``;
    const bedroomsClause =
      bedroomsMin !== null && bedroomsMin > 0
        ? sql`and u.bedrooms >= ${bedroomsMin}`
        : sql``;
    const bathroomsClause =
      bathroomsMin !== null && bathroomsMin > 0
        ? sql`and u.bathrooms >= ${bathroomsMin}`
        : sql``;
    const currencyClause = currency ? sql`and sp.currency = ${currency}` : sql``;
    const priceExpr = sql`coalesce(
      (
        select sid.effective_rate_minor::bigint
        from stay_inventory_days sid
        where sid.unit_id = u.id
          and sid.availability_status = 'available'
          and sid.stay_date >= current_date
        order by sid.stay_date
        limit 1
      ),
      (
        select srp.base_nightly_minor::bigint
        from stay_rate_plans srp
        where srp.stay_profile_id = sp.id
          and srp.enabled = true
        order by srp.priority asc, srp.created_at asc
        limit 1
      ),
      0
    )`;
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

    const result = await transaction.execute(sql`
      select
        spl.slug as slug,
        spl.published_at as published_at,
        p.id::text as property_id,
        u.id::text as unit_id,
        u.code as unit_code,
        p.kind::text as property_kind,
        p.serial_number as property_serial,
        p.category::text as category,
        u.name_ar as unit_name_ar,
        u.name_en as unit_name_en,
        p.name_ar as property_name_ar,
        p.name_en as property_name_en,
        coalesce(u.bedrooms, 0) as bedrooms,
        coalesce(u.bathrooms, 0) as bathrooms,
        u.area_square_meters as area_square_meters,
        sp.max_guests as max_guests,
        (
          select coalesce(sid.effective_rate_minor, srp.base_nightly_minor)::text
          from stay_rate_plans srp
          left join lateral (
            select sid.effective_rate_minor
            from stay_inventory_days sid
            where sid.unit_id = u.id
              and sid.availability_status = 'available'
              and sid.stay_date >= current_date
            order by sid.stay_date
            limit 1
          ) inv on true
          where srp.stay_profile_id = sp.id
            and srp.enabled = true
          order by srp.priority asc, srp.created_at asc
          limit 1
        ) as nightly_minor,
        sp.currency as currency,
        coalesce(a.governorate, '') as governorate,
        coalesce(a.wilayat, '') as wilayat,
        a.city as city,
        a.area as area,
        a.street as street,
        sp.updated_at as profile_updated_at,
        (
          select ma.id::text
          from unit_media um
          join media_assets ma on ma.id = um.media_asset_id
          where um.unit_id = u.id
            and ma.processing_status = 'ready'
            and ma.scan_status = 'clean'
            and ma.mime_type like 'image/%'
            and coalesce(ma.metadata->>'galleryScope', 'unit') <> 'building'
          order by um.position asc
          limit 1
        ) as unit_cover_asset_id,
        (
          select ma.id::text
          from unit_media um
          join media_assets ma on ma.id = um.media_asset_id
          join units bu on bu.id = um.unit_id
          where bu.property_id = p.id
            and ma.processing_status = 'ready'
            and ma.scan_status = 'clean'
            and ma.mime_type like 'image/%'
            and ma.metadata->>'galleryScope' = 'building'
          order by um.position asc
          limit 1
        ) as building_cover_asset_id,
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
        u.has_pool as has_pool,
        coalesce(pp.parking_spaces, 0) as parking_spaces,
        (
          select coalesce(array_agg(pa.code order by pa.code), '{}'::text[])
          from property_amenities pa
          where pa.property_id = p.id
        ) as amenity_codes,
        case when a.location is not null then ST_Y(a.location::geometry) else null end as latitude,
        case when a.location is not null then ST_X(a.location::geometry) else null end as longitude,
        pp.notes as maps_note
      from stay_profiles sp
      inner join units u on u.id = sp.unit_id
      inner join properties p on p.id = u.property_id
      inner join addresses a on a.id = p.address_id
      left join property_profiles pp on pp.property_id = p.id
      inner join stay_public_listings spl
        on spl.property_id = p.id
       and spl.organization_id = sp.organization_id
       and spl.enabled = true
       and spl.published_at is not null
      inner join stay_unit_types sut
        on sut.id = sp.unit_type_id
       and sut.id = spl.unit_type_id
       and sut.organization_id = spl.organization_id
      where sp.enabled = true
        and sp.publish_status = 'published'
        ${countryClause}
        ${governorateClause}
        ${wilayatClause}
        ${villageClause}
        ${categoryClause}
        ${bedroomsClause}
        ${bathroomsClause}
        ${currencyClause}
        ${priceMinClause}
        ${priceMaxClause}
        ${poolClause}
        ${parkingClause}
        ${amenitiesClause}
        ${qClause}
      order by spl.published_at desc nulls last, sp.updated_at desc, u.code asc, u.id asc
      limit ${limit}
    `);

    const rawUnknown = result as unknown;
    const rows: StayCatalogueRow[] = Array.isArray(rawUnknown)
      ? (rawUnknown as StayCatalogueRow[])
      : Array.isArray((rawUnknown as { rows?: StayCatalogueRow[] }).rows)
        ? (rawUnknown as { rows: StayCatalogueRow[] }).rows
        : [];

    const serialsByProperty = new Map<string, Map<string, string>>();
    for (const row of rows) {
      if (serialsByProperty.has(row.property_id)) continue;
      const siblings = rows
        .filter((item) => item.property_id === row.property_id)
        .sort((a, b) => String(a.unit_code ?? '').localeCompare(String(b.unit_code ?? '')));
      serialsByProperty.set(
        row.property_id,
        assignUnitSerials(
          row.property_serial,
          siblings.map((item) => ({
            id: item.unit_id,
            code: item.unit_code,
            nameAr: item.unit_name_ar,
            nameEn: item.unit_name_en,
          })),
        ),
      );
    }

    const data: StayCatalogueListing[] = rows.map((row) => {
      const publishedAt =
        row.published_at instanceof Date
          ? row.published_at
          : row.published_at
            ? new Date(row.published_at)
            : row.profile_updated_at
              ? new Date(row.profile_updated_at)
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
      const isMulti = row.property_kind === 'multi_unit';
      const unitKind = inferUnitKind({
        code: row.unit_code,
        nameAr: row.unit_name_ar,
        nameEn: row.unit_name_en,
      });
      const category = (
        isMulti ? unitKindToCategory(unitKind) : row.category
      ) as PublicListing['category'];
      const propertyKind =
        row.property_kind === 'multi_unit' || row.property_kind === 'single_unit'
          ? row.property_kind
          : null;
      const coverAssetId =
        row.unit_cover_asset_id ?? row.cover_asset_id ?? row.building_cover_asset_id;
      const unitSerial = serialsByProperty.get(row.property_id)?.get(row.unit_id) ?? null;

      return {
        id: row.unit_id,
        slug: row.slug,
        unitId: row.unit_id,
        unitCode: row.unit_code,
        unitNameAr: row.unit_name_ar,
        unitNameEn: row.unit_name_en,
        propertyId: row.property_id,
        propertyNameAr: row.property_name_ar,
        propertyNameEn: row.property_name_en,
        propertyKind,
        category,
        governorate: row.governorate ?? '',
        wilayat: row.wilayat ?? '',
        city: row.city,
        area: row.area,
        street: row.street,
        bedrooms: row.bedrooms,
        bathrooms: row.bathrooms,
        areaSquareMeters:
          row.area_square_meters !== null && row.area_square_meters !== undefined
            ? Number(row.area_square_meters)
            : null,
        maxGuests: row.max_guests,
        nightlyMinor: row.nightly_minor,
        currency: row.currency,
        coverImageUrl: coverAssetId ? `/api/public/media/${coverAssetId}` : null,
        publishedAt: publishedAt.toISOString(),
        hasPool: Boolean(row.has_pool) || (row.amenity_codes ?? []).includes('pool'),
        parkingSpaces: row.parking_spaces ?? 0,
        amenities: row.amenity_codes ?? [],
        latitude,
        longitude,
        mapsUrl,
        unitSerial,
      };
    });

    return {
      data,
      pagination: { nextCursor: null, hasMore: false },
    };
  });
}

export { asPublicListingCategory };
