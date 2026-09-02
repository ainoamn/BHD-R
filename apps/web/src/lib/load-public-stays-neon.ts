import 'server-only';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@bhd-r/db';
import type { StayPublicDetail, StaySearchQuery, StaySearchResponse } from '@bhd-r/contracts';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRPublicStaysDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRPublicStaysDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRPublicStaysDb = { db };
  }
  return globalForDb.__bhdRPublicStaysDb;
}

async function asPublic<T>(
  work: (transaction: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.public', 'true', true)`);
    await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
    return work(transaction);
  });
}

/** Public stays search from Neon when Nest is slow or unavailable. */
export async function searchPublicStaysOnNeon(
  query: StaySearchQuery,
): Promise<StaySearchResponse> {
  const guests = query.adults + query.children;
  const hasDates = Boolean(query.checkInOn && query.checkOutOn);
  if (hasDates && query.checkInOn! >= query.checkOutOn!) {
    return { items: [], nextCursor: null, cached: false };
  }

  const limit = query.limit;
  const rows = await asPublic(async (transaction) => {
    const result = await transaction.execute(sql`
      WITH candidates AS (
        SELECT
          spl.slug,
          spl.title_ar,
          spl.title_en,
          a.governorate AS destination,
          sp.max_guests,
          sp.currency AS profile_currency,
          u.id AS unit_id,
          (
            SELECT sid.effective_rate_minor::text
            FROM stay_inventory_days sid
            WHERE sid.unit_id = u.id
              AND sid.availability_status = 'available'
              AND (
                ${query.checkInOn ?? null}::date IS NULL
                OR sid.stay_date = ${query.checkInOn ?? null}::date
              )
            ORDER BY sid.stay_date
            LIMIT 1
          ) AS nightly_minor,
          (
            SELECT srp.base_nightly_minor::text
            FROM stay_profiles sp2
            INNER JOIN stay_rate_plans srp
              ON srp.stay_profile_id = sp2.id
             AND srp.enabled = true
            WHERE sp2.unit_id = u.id
              AND sp2.organization_id = spl.organization_id
              AND sp2.enabled = true
              AND sp2.publish_status = 'published'
            ORDER BY srp.priority ASC, srp.created_at ASC
            LIMIT 1
          ) AS rate_plan_minor,
          (
            SELECT sid.currency
            FROM stay_inventory_days sid
            WHERE sid.unit_id = u.id
              AND sid.availability_status = 'available'
              AND (
                ${query.checkInOn ?? null}::date IS NULL
                OR sid.stay_date = ${query.checkInOn ?? null}::date
              )
            ORDER BY sid.stay_date
            LIMIT 1
          ) AS night_currency,
          (
            SELECT '/api/public/media/' || ma.id::text
            FROM unit_media um
            INNER JOIN media_assets ma ON ma.id = um.media_asset_id
            INNER JOIN units bu ON bu.id = um.unit_id
            WHERE bu.property_id = p.id
              AND ma.processing_status = 'ready'
              AND ma.scan_status = 'clean'
              AND ma.mime_type LIKE 'image/%'
            ORDER BY
              CASE WHEN ma.metadata->>'galleryScope' = 'building' THEN 0 ELSE 1 END,
              um.position ASC
            LIMIT 1
          ) AS cover_image_url
        FROM stay_public_listings spl
        INNER JOIN properties p
          ON p.id = spl.property_id
         AND p.organization_id = spl.organization_id
        INNER JOIN addresses a ON a.id = p.address_id
        INNER JOIN stay_unit_types sut
          ON sut.id = spl.unit_type_id
         AND sut.organization_id = spl.organization_id
        INNER JOIN stay_profiles sp
          ON sp.unit_type_id = sut.id
         AND sp.organization_id = spl.organization_id
         AND sp.enabled = true
         AND sp.publish_status = 'published'
        INNER JOIN units u
          ON u.id = sp.unit_id
         AND u.organization_id = spl.organization_id
        WHERE spl.enabled = true
          AND spl.published_at IS NOT NULL
          AND a.country_code = ${query.countryCode}
          AND (${query.governorate ?? null}::text IS NULL OR a.governorate = ${query.governorate ?? null})
          AND (${query.wilayat ?? null}::text IS NULL OR a.wilayat = ${query.wilayat ?? null})
          AND sp.max_guests >= ${guests}
      )
      SELECT DISTINCT ON (slug)
        slug,
        title_ar,
        title_en,
        destination,
        COALESCE(nightly_minor, rate_plan_minor) AS nightly_minor,
        COALESCE(night_currency, profile_currency) AS currency,
        max_guests,
        unit_id,
        cover_image_url
      FROM candidates
      WHERE (
        ${query.minNightlyMinor ?? null}::text IS NULL
        OR (COALESCE(nightly_minor, rate_plan_minor) IS NOT NULL
          AND COALESCE(nightly_minor, rate_plan_minor)::bigint >= ${query.minNightlyMinor ?? null}::bigint)
      )
      AND (
        ${query.maxNightlyMinor ?? null}::text IS NULL
        OR (COALESCE(nightly_minor, rate_plan_minor) IS NOT NULL
          AND COALESCE(nightly_minor, rate_plan_minor)::bigint <= ${query.maxNightlyMinor ?? null}::bigint)
      )
      AND (
        ${query.currency ?? null}::text IS NULL
        OR COALESCE(night_currency, profile_currency) = ${query.currency ?? null}
      )
      AND (
        ${query.cursor ?? null}::text IS NULL
        OR slug > ${query.cursor ?? null}
      )
      ORDER BY slug
      LIMIT ${limit + 1}
    `);
    return Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  });

  const sliced = rows.slice(0, limit) as Array<{
    slug: string;
    title_ar: string;
    title_en: string;
    destination: string | null;
    nightly_minor: string | null;
    currency: string | null;
    max_guests: number | null;
    unit_id: string;
    cover_image_url: string | null;
  }>;
  const next = rows.length > limit ? sliced[sliced.length - 1]?.slug ?? null : null;

  return {
    items: sliced.map((row) => ({
      slug: row.slug,
      titleAr: row.title_ar,
      titleEn: row.title_en,
      destination: row.destination,
      nightlyMinor: row.nightly_minor,
      currency: (row.currency as StaySearchResponse['items'][number]['currency']) ?? null,
      coverImageUrl: row.cover_image_url,
      maxGuests: row.max_guests,
      unitId: row.unit_id,
    })),
    nextCursor: next,
    cached: false,
  };
}

/** Public stay detail from Neon. */
export async function loadPublicStayBySlugOnNeon(slug: string): Promise<StayPublicDetail | null> {
  if (!slug.trim()) return null;

  return asPublic(async (transaction) => {
    const result = await transaction.execute(sql`
      SELECT
        spl.slug,
        spl.title_ar,
        spl.title_en,
        spl.summary_ar AS description_ar,
        spl.summary_en AS description_en,
        a.governorate AS destination,
        a.wilayat,
        a.city,
        sp.max_guests,
        sp.currency AS profile_currency,
        sp.check_in_from,
        sp.check_out_until,
        sp.day_use_check_out_until,
        sp.overnight_check_out_until,
        sp.day_use_max_guests,
        sp.overnight_max_guests,
        sp.deposit_minor::text AS deposit_minor,
        sp.policies_ar,
        sp.policies_en,
        sp.policies_json,
        sp.instructions_ar,
        sp.instructions_en,
        u.id AS unit_id,
        u.bedrooms,
        u.bathrooms,
        u.area_square_meters,
        p.id AS property_id,
        p.name_ar AS property_name_ar,
        p.name_en AS property_name_en,
        (
          SELECT sid.effective_rate_minor::text
          FROM stay_inventory_days sid
          WHERE sid.unit_id = u.id
            AND sid.availability_status = 'available'
            AND sid.stay_date >= CURRENT_DATE
          ORDER BY sid.stay_date
          LIMIT 1
        ) AS nightly_minor,
        (
          SELECT srp.base_nightly_minor::text
          FROM stay_rate_plans srp
          WHERE srp.stay_profile_id = sp.id
            AND srp.enabled = true
          ORDER BY srp.priority ASC, srp.created_at ASC
          LIMIT 1
        ) AS rate_plan_minor,
        (
          SELECT srp.day_use_minor::text
          FROM stay_rate_plans srp
          WHERE srp.stay_profile_id = sp.id
            AND srp.enabled = true
          ORDER BY srp.priority ASC, srp.created_at ASC
          LIMIT 1
        ) AS day_use_minor,
        (
          SELECT srp.overnight_only_minor::text
          FROM stay_rate_plans srp
          WHERE srp.stay_profile_id = sp.id
            AND srp.enabled = true
          ORDER BY srp.priority ASC, srp.created_at ASC
          LIMIT 1
        ) AS overnight_only_minor,
        (
          SELECT sid.currency
          FROM stay_inventory_days sid
          WHERE sid.unit_id = u.id
            AND sid.availability_status = 'available'
            AND sid.stay_date >= CURRENT_DATE
          ORDER BY sid.stay_date
          LIMIT 1
        ) AS night_currency,
        (
          SELECT '/api/public/media/' || ma.id::text
          FROM unit_media um
          INNER JOIN media_assets ma ON ma.id = um.media_asset_id
          INNER JOIN units bu ON bu.id = um.unit_id
          WHERE bu.property_id = p.id
            AND ma.processing_status = 'ready'
            AND ma.scan_status = 'clean'
            AND ma.mime_type LIKE 'image/%'
          ORDER BY
            CASE WHEN ma.metadata->>'galleryScope' = 'building' THEN 0 ELSE 1 END,
            um.position ASC
          LIMIT 1
        ) AS cover_image_url
      FROM stay_public_listings spl
      INNER JOIN properties p
        ON p.id = spl.property_id
       AND p.organization_id = spl.organization_id
      INNER JOIN addresses a ON a.id = p.address_id
      INNER JOIN stay_unit_types sut
        ON sut.id = spl.unit_type_id
       AND sut.organization_id = spl.organization_id
      INNER JOIN stay_profiles sp
        ON sp.unit_type_id = sut.id
       AND sp.organization_id = spl.organization_id
       AND sp.enabled = true
       AND sp.publish_status = 'published'
      INNER JOIN units u
        ON u.id = sp.unit_id
       AND u.organization_id = spl.organization_id
      WHERE spl.slug = ${slug}
        AND spl.enabled = true
        AND spl.published_at IS NOT NULL
      ORDER BY
        CASE WHEN COALESCE(u.bedrooms, 0) > 0 THEN 0 ELSE 1 END,
        u.bedrooms DESC NULLS LAST,
        sp.updated_at DESC
      LIMIT 1
    `);
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    const row = rows[0] as
      | {
          slug: string;
          title_ar: string;
          title_en: string;
          description_ar: string | null;
          description_en: string | null;
          destination: string | null;
          wilayat: string | null;
          city: string | null;
          max_guests: number | null;
          profile_currency: string | null;
          check_in_from: string | null;
          check_out_until: string | null;
          day_use_check_out_until: string | null;
          overnight_check_out_until: string | null;
          day_use_max_guests: number | null;
          overnight_max_guests: number | null;
          deposit_minor: string | null;
          policies_ar: string | null;
          policies_en: string | null;
          policies_json: string[] | null;
          instructions_ar: string | null;
          instructions_en: string | null;
          unit_id: string;
          bedrooms: number | null;
          bathrooms: number | null;
          area_square_meters: number | null;
          property_id: string;
          property_name_ar: string;
          property_name_en: string;
          nightly_minor: string | null;
          rate_plan_minor: string | null;
          day_use_minor: string | null;
          overnight_only_minor: string | null;
          night_currency: string | null;
          cover_image_url: string | null;
        }
      | undefined;
    if (!row) return null;

    const imageResult = await transaction.execute(sql`
      SELECT '/api/public/media/' || ma.id::text AS url
      FROM unit_media um
      INNER JOIN media_assets ma ON ma.id = um.media_asset_id
      INNER JOIN units bu ON bu.id = um.unit_id
      WHERE bu.property_id = ${row.property_id}::uuid
        AND ma.processing_status = 'ready'
        AND ma.scan_status = 'clean'
        AND ma.mime_type LIKE 'image/%'
      ORDER BY
        CASE WHEN ma.metadata->>'galleryScope' = 'building' THEN 0 ELSE 1 END,
        um.position ASC
      LIMIT 12
    `);
    const imageRows = (
      Array.isArray(imageResult) ? imageResult : ((imageResult as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ url: string }>;

    const smart = await loadStaySmartScoreOnNeon(transaction, row.property_id, row.unit_id);

    return {
      slug: row.slug,
      titleAr: row.title_ar,
      titleEn: row.title_en,
      descriptionAr: row.description_ar,
      descriptionEn: row.description_en,
      destination: row.destination,
      wilayat: row.wilayat,
      city: row.city,
      nightlyMinor: row.nightly_minor ?? row.rate_plan_minor,
      dayUseMinor: row.day_use_minor,
      overnightOnlyMinor: row.overnight_only_minor,
      currency:
        ((row.night_currency ?? row.profile_currency) as StayPublicDetail['currency']) ?? null,
      maxGuests: row.max_guests,
      unitId: row.unit_id,
      propertyId: row.property_id,
      propertyNameAr: row.property_name_ar,
      propertyNameEn: row.property_name_en,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      areaSquareMeters: row.area_square_meters,
      checkInFrom: row.check_in_from,
      checkOutUntil: row.check_out_until,
      dayUseCheckOutUntil: row.day_use_check_out_until,
      overnightCheckOutUntil: row.overnight_check_out_until ?? row.check_out_until,
      dayUseMaxGuests: row.day_use_max_guests,
      overnightMaxGuests: row.overnight_max_guests,
      depositMinor: row.deposit_minor,
      policiesAr: row.policies_ar,
      policiesEn: row.policies_en,
      policiesJson: Array.isArray(row.policies_json) ? row.policies_json : [],
      instructionsAr: row.instructions_ar,
      instructionsEn: row.instructions_en,
      coverImageUrl: row.cover_image_url,
      imageUrls: imageRows.map((item) => item.url),
      guestScoreTen: smart.guestScoreTen,
      occupancyPercent: smart.occupancyPercent,
      smartScoreTen: smart.smartScoreTen,
      stayReviewCount: smart.stayReviewCount,
    };
  });
}

async function loadStaySmartScoreOnNeon(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  propertyId: string,
  unitId: string,
): Promise<{
  guestScoreTen: number | null;
  occupancyPercent: number | null;
  smartScoreTen: number | null;
  stayReviewCount: number;
}> {
  const reviewResult = await transaction.execute(sql`
    SELECT
      avg(sr.rating)::float AS avg_rating,
      count(*)::int AS review_count
    FROM stay_reviews sr
    INNER JOIN stay_bookings sb ON sb.id = sr.booking_id
    WHERE sb.property_id = ${propertyId}::uuid
      AND sr.status = 'published'
  `);
  const reviewRows = (
    Array.isArray(reviewResult) ? reviewResult : ((reviewResult as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ avg_rating: number | null; review_count: number | null }>;
  const reviewCount = Number(reviewRows[0]?.review_count ?? 0);
  const avgFive = reviewCount > 0 ? Number(reviewRows[0]?.avg_rating ?? 0) : null;
  const guestScoreTen =
    avgFive != null && Number.isFinite(avgFive)
      ? Math.round(avgFive * 2 * 10) / 10
      : null;

  const occResult = await transaction.execute(sql`
    WITH days AS (
      SELECT
        count(*) FILTER (WHERE sid.availability_status IN ('booked', 'blocked', 'hold'))::float AS busy,
        count(*)::float AS total
      FROM stay_inventory_days sid
      WHERE sid.unit_id = ${unitId}::uuid
        AND sid.stay_date >= (CURRENT_DATE - INTERVAL '90 days')
        AND sid.stay_date < CURRENT_DATE
    )
    SELECT
      CASE WHEN total > 0 THEN round((busy / total) * 100)::float ELSE NULL END AS occupancy_percent
    FROM days
  `);
  const occRows = (
    Array.isArray(occResult) ? occResult : ((occResult as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ occupancy_percent: number | null }>;
  const occupancyPercent =
    occRows[0]?.occupancy_percent != null && Number.isFinite(Number(occRows[0].occupancy_percent))
      ? Number(occRows[0].occupancy_percent)
      : null;

  let smartScoreTen: number | null = null;
  if (guestScoreTen != null && occupancyPercent != null) {
    const occScore = Math.min(10, Math.max(0, occupancyPercent / 10));
    smartScoreTen = Math.round((guestScoreTen * 0.8 + occScore * 0.2) * 10) / 10;
  } else if (guestScoreTen != null) {
    smartScoreTen = guestScoreTen;
  } else if (occupancyPercent != null) {
    smartScoreTen = Math.round(Math.min(10, Math.max(0, occupancyPercent / 10)) * 10) / 10;
  }

  return { guestScoreTen, occupancyPercent, smartScoreTen, stayReviewCount: reviewCount };
}
