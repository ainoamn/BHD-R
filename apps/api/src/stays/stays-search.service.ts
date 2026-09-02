import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import type { StaySearchQuery, StaySearchResponse, StayPublicDetail } from '@bhd-r/contracts';
import { DatabaseService } from '../database/database.service.js';

const SEARCH_TTL_SECONDS = 45;

@Injectable()
export class StaysSearchService implements OnModuleDestroy {
  private readonly logger = new Logger(StaysSearchService.name);
  private readonly redis: Redis | null;

  constructor(private readonly database: DatabaseService) {
    const url = process.env.REDIS_URL?.trim();
    if (url && /^rediss?:\/\//i.test(url)) {
      this.redis = new Redis(url, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        lazyConnect: true,
        connectionName: 'bhd-r-api-stays-search',
      });
      void this.redis.connect().catch((error) => {
        this.logger.warn(
          `Redis stays search cache unavailable: ${error instanceof Error ? error.message : error}`,
        );
      });
    } else {
      this.redis = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        this.redis.disconnect();
      }
    }
  }

  async search(query: StaySearchQuery): Promise<StaySearchResponse> {
    const cacheKey = this.cacheKey('search', query);
    const cached = await this.readCache<StaySearchResponse>(cacheKey);
    if (cached) return { ...cached, cached: true };

    const guests = query.adults + query.children;
    const hasDates = Boolean(query.checkInOn && query.checkOutOn);
    if (hasDates && query.checkInOn! >= query.checkOutOn!) {
      return { items: [], nextCursor: null, cached: false };
    }

    const limit = query.limit;
    const rows = await this.database.asPublic(async (transaction) => {
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
          INNER JOIN addresses a
            ON a.id = p.address_id
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
            AND (
              ${hasDates} = false
              OR NOT EXISTS (
                SELECT 1
                FROM generate_series(
                  ${query.checkInOn ?? null}::date,
                  (${query.checkOutOn ?? null}::date - 1),
                  '1 day'::interval
                ) AS d(day)
                WHERE NOT EXISTS (
                  SELECT 1
                  FROM stay_inventory_days sid
                  WHERE sid.unit_id = u.id
                    AND sid.stay_date = d.day::date
                    AND sid.availability_status = 'available'
                )
              )
            )
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
          OR (nightly_minor IS NOT NULL AND nightly_minor::bigint >= ${query.minNightlyMinor ?? null}::bigint)
        )
        AND (
          ${query.maxNightlyMinor ?? null}::text IS NULL
          OR (nightly_minor IS NOT NULL AND nightly_minor::bigint <= ${query.maxNightlyMinor ?? null}::bigint)
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

    const response: StaySearchResponse = {
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

    await this.writeCache(cacheKey, response);
    return response;
  }

  async getBySlug(slug: string): Promise<StayPublicDetail | null> {
    const cacheKey = this.cacheKey('detail', { slug });
    const cached = await this.readCache<StayPublicDetail>(cacheKey);
    if (cached) return cached;

    const rows = await this.database.asPublic(async (transaction) => {
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
      return Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    });

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
          unit_id: string;
          bedrooms: number | null;
          bathrooms: number | null;
          area_square_meters: number | null;
          property_id: string;
          property_name_ar: string;
          property_name_en: string;
          nightly_minor: string | null;
          rate_plan_minor: string | null;
          night_currency: string | null;
          cover_image_url: string | null;
        }
      | undefined;
    if (!row) return null;

    const imageRows = await this.database.asPublic(async (transaction) => {
      const result = await transaction.execute(sql`
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
      return Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    });

    const detail: StayPublicDetail = {
      slug: row.slug,
      titleAr: row.title_ar,
      titleEn: row.title_en,
      descriptionAr: row.description_ar,
      descriptionEn: row.description_en,
      destination: row.destination,
      wilayat: row.wilayat,
      city: row.city,
      nightlyMinor: row.nightly_minor ?? row.rate_plan_minor,
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
      coverImageUrl: row.cover_image_url,
      imageUrls: (imageRows as Array<{ url: string }>).map((item) => item.url),
    };
    await this.writeCache(cacheKey, detail);
    return detail;
  }

  private cacheKey(kind: string, payload: unknown): string {
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
    return `stays:${kind}:${hash}`;
  }

  private async readCache<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, value: unknown): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', SEARCH_TTL_SECONDS);
    } catch (error) {
      this.logger.debug(
        `stays cache write skipped: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
