import 'server-only';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  addresses,
  createDatabase,
  listings,
  mediaAssets,
  properties,
  unitMedia,
  units,
  type Database,
} from '@bhd-r/db';
import type { PublicUnitDetail } from '@bhd-r/contracts';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRPublicUnitDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRPublicUnitDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRPublicUnitDb = { db };
  }
  return globalForDb.__bhdRPublicUnitDb;
}

/** Public unit detail from Neon (covers Nest downtime + inline Neon gallery). */
export async function loadPublicUnitFromNeon(unitId: string): Promise<PublicUnitDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(unitId)) return null;
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.public', 'true', true)`);
    await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);

    const rows = await transaction
      .select({
        id: listings.id,
        slug: listings.slug,
        propertyId: properties.id,
        unitId: units.id,
        code: units.code,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        unitNameAr: units.nameAr,
        unitNameEn: units.nameEn,
        descriptionAr: properties.descriptionAr,
        descriptionEn: properties.descriptionEn,
        category: properties.category,
        bedrooms: units.bedrooms,
        bathrooms: units.bathrooms,
        areaSquareMeters: units.areaSquareMeters,
        listingPurpose: units.listingPurpose,
        rentMinor: units.rentMinor,
        salePriceMinor: units.salePriceMinor,
        depositMinor: units.depositMinor,
        currency: units.currency,
        governorate: addresses.governorate,
        wilayat: addresses.wilayat,
        city: addresses.city,
      })
      .from(listings)
      .innerJoin(units, eq(units.id, listings.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .innerJoin(addresses, eq(addresses.id, properties.addressId))
      .where(
        and(
          eq(units.id, unitId),
          eq(listings.enabled, true),
          isNotNull(listings.publishedAt),
          eq(units.publishWhenAvailable, true),
          eq(units.status, 'active'),
          eq(properties.status, 'active'),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const imageRows = await transaction
      .select({
        id: mediaAssets.id,
        mimeType: mediaAssets.mimeType,
        metadata: mediaAssets.metadata,
      })
      .from(unitMedia)
      .innerJoin(mediaAssets, eq(mediaAssets.id, unitMedia.mediaAssetId))
      .where(
        and(
          eq(unitMedia.unitId, unitId),
          eq(mediaAssets.processingStatus, 'ready'),
          eq(mediaAssets.scanStatus, 'clean'),
        ),
      )
      .orderBy(asc(unitMedia.position))
      .limit(40);

    const currency = row.currency as PublicUnitDetail['rent']['currency'];
    return {
      id: row.id,
      slug: row.slug,
      propertyId: row.propertyId,
      unitId: row.unitId,
      code: row.code,
      propertyNameAr: row.propertyNameAr,
      propertyNameEn: row.propertyNameEn,
      unitNameAr: row.unitNameAr,
      unitNameEn: row.unitNameEn,
      descriptionAr: row.descriptionAr,
      descriptionEn: row.descriptionEn,
      category: row.category as PublicUnitDetail['category'],
      governorate: row.governorate,
      wilayat: row.wilayat,
      city: row.city,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      areaSquareMeters:
        row.areaSquareMeters === null || row.areaSquareMeters === undefined
          ? null
          : String(row.areaSquareMeters),
      listingPurpose: row.listingPurpose as PublicUnitDetail['listingPurpose'],
      rent: { amountMinor: row.rentMinor.toString(), currency },
      salePrice:
        row.salePriceMinor === null
          ? null
          : { amountMinor: row.salePriceMinor.toString(), currency },
      deposit:
        row.depositMinor === null
          ? null
          : { amountMinor: row.depositMinor.toString(), currency },
      available: true as const,
      images: imageRows
        .filter((image) => image.mimeType.startsWith('image/'))
        .map((image) => {
          const meta = (image.metadata ?? {}) as Record<string, unknown>;
          return {
            id: image.id,
            url: `/api/public/media/${image.id}`,
            ...(typeof meta.altAr === 'string' ? { altAr: meta.altAr } : {}),
            ...(typeof meta.altEn === 'string' ? { altEn: meta.altEn } : {}),
          };
        }),
    };
  });
}
