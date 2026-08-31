import 'server-only';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  addresses,
  createDatabase,
  listings,
  mediaAssets,
  parties,
  properties,
  propertyAmenities,
  unitMedia,
  units,
  type Database,
} from '@bhd-r/db';
import type { CurrencyCode } from '@bhd-r/contracts';
import type { ManagedProperty } from '@/components/property-detail-manager';
import { googleMapsLinkFromCoords } from '@/lib/parse-google-maps-url';
import { loadPropertyProfileRow } from '@/lib/load-property-profile';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRPublicPropertyDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRPublicPropertyDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRPublicPropertyDb = { db };
  }
  return globalForDb.__bhdRPublicPropertyDb;
}

function extractMapsUrl(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const match = notes.match(/Google Maps:\s*(https?:\/\/\S+)/i);
  return match?.[1]?.replace(/[.,;]+$/, '') ?? null;
}

function s3Configured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT?.trim() &&
      process.env.S3_ACCESS_KEY?.trim() &&
      process.env.S3_SECRET_KEY?.trim() &&
      !String(process.env.S3_ENDPOINT).includes('example.com'),
  );
}

/**
 * Public marketing view of a property (UUID capability URL).
 * Uses a privileged DB context so unpublished draft properties can still be
 * shared via QR / «عرض العقار» without exposing owner-only documents.
 */
export async function loadPublicPropertyShowcaseFromNeon(
  propertyId: string,
): Promise<ManagedProperty | null> {
  if (!/^[0-9a-f-]{36}$/i.test(propertyId)) return null;
  const { healPublicCatalogueListings } = await import('@/lib/heal-public-listings');
  await healPublicCatalogueListings({ propertyId }).catch(() => undefined);

  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    // Prefer public RLS; elevate only for capability-URL drafts (QR share) — P1-04.
    await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
    await transaction.execute(sql`select set_config('app.public', 'true', true)`);

    let property = await transaction.query.properties.findFirst({
      where: and(eq(properties.id, propertyId), ne(properties.status, 'archived')),
    });
    if (!property) {
      await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
      await transaction.execute(sql`select set_config('app.public', 'false', true)`);
      property = await transaction.query.properties.findFirst({
        where: and(eq(properties.id, propertyId), ne(properties.status, 'archived')),
      });
    }
    if (!property) return null;

    const [address, profile, amenities, unitRows, coords, ownerParty] = await Promise.all([
      transaction.query.addresses.findFirst({ where: eq(addresses.id, property.addressId) }),
      loadPropertyProfileRow(transaction, property.id),
      transaction
        .select()
        .from(propertyAmenities)
        .where(eq(propertyAmenities.propertyId, property.id)),
      transaction
        .select({
          id: units.id,
          propertyId: units.propertyId,
          code: units.code,
          nameAr: units.nameAr,
          nameEn: units.nameEn,
          floor: units.floor,
          bedrooms: units.bedrooms,
          bathrooms: units.bathrooms,
          majlis: units.majlis,
          halls: units.halls,
          kitchens: units.kitchens,
          hasPool: units.hasPool,
          areaSquareMeters: units.areaSquareMeters,
          rentMinor: units.rentMinor,
          salePriceMinor: units.salePriceMinor,
          depositMinor: units.depositMinor,
          currency: units.currency,
          minorUnit: units.minorUnit,
          listingPurpose: units.listingPurpose,
          publishWhenAvailable: units.publishWhenAvailable,
          status: units.status,
          listingId: listings.id,
          listingEnabled: listings.enabled,
          listingSlug: listings.slug,
        })
        .from(units)
        .leftJoin(listings, eq(listings.unitId, units.id))
        .where(eq(units.propertyId, property.id))
        .orderBy(asc(units.code)),
        transaction.execute(sql`
          select
            ST_Y(location::geometry) as lat,
            ST_X(location::geometry) as lon
          from addresses
          where id = ${property.addressId}
        `),
      property.ownerPartyId
        ? transaction.query.parties.findFirst({ where: eq(parties.id, property.ownerPartyId) })
        : Promise.resolve(null),
    ]);

    const coordRow = (Array.isArray(coords) ? coords[0] : null) as
      | { lat?: number | string | null; lon?: number | string | null }
      | null;
    const latitude =
      coordRow?.lat !== null && coordRow?.lat !== undefined && Number.isFinite(Number(coordRow.lat))
        ? Number(coordRow.lat)
        : null;
    const longitude =
      coordRow?.lon !== null && coordRow?.lon !== undefined && Number.isFinite(Number(coordRow.lon))
        ? Number(coordRow.lon)
        : null;
    let mapsUrl = extractMapsUrl(profile?.notes ?? null);
    if (
      !mapsUrl &&
      typeof latitude === 'number' &&
      Number.isFinite(latitude) &&
      typeof longitude === 'number' &&
      Number.isFinite(longitude)
    ) {
      mapsUrl = googleMapsLinkFromCoords(latitude, longitude);
    }

    const unitIds = unitRows.map((unit) => unit.id);
    const occupancyByUnit = new Map<string, 'available' | 'reserved' | 'leased' | 'sold'>();
    if (unitIds.length) {
      const occRows = (await transaction.execute(sql`
        select
          u.id::text as unit_id,
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
          end as occupancy
        from units u
        where u.id in (${sql.join(
          unitIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
      `)) as unknown;
      const list: Array<{ unit_id: string; occupancy: string }> = Array.isArray(occRows)
        ? (occRows as Array<{ unit_id: string; occupancy: string }>)
        : Array.isArray((occRows as { rows?: Array<{ unit_id: string; occupancy: string }> }).rows)
          ? ((occRows as { rows: Array<{ unit_id: string; occupancy: string }> }).rows)
          : [];
      for (const row of list) {
        if (
          row.occupancy === 'sold' ||
          row.occupancy === 'leased' ||
          row.occupancy === 'reserved' ||
          row.occupancy === 'available'
        ) {
          occupancyByUnit.set(row.unit_id, row.occupancy);
        }
      }
    }

    let gallery: ManagedProperty['gallery'] = [];
    if (unitIds.length) {
      const mediaRows = await transaction
        .select({
          id: mediaAssets.id,
          mimeType: mediaAssets.mimeType,
          position: unitMedia.position,
          unitId: unitMedia.unitId,
          metadata: mediaAssets.metadata,
        })
        .from(unitMedia)
        .innerJoin(mediaAssets, eq(mediaAssets.id, unitMedia.mediaAssetId))
        .where(
          and(
            eq(unitMedia.organizationId, property.organizationId),
            inArray(unitMedia.unitId, unitIds),
            eq(mediaAssets.processingStatus, 'ready'),
            eq(mediaAssets.scanStatus, 'clean'),
          ),
        )
        .orderBy(asc(unitMedia.position));
      gallery = mediaRows
        .filter((row) => row.mimeType.startsWith('image/'))
        .map((row) => {
          const meta = (row.metadata ?? {}) as { galleryScope?: string };
          const galleryScope =
            meta.galleryScope === 'building' || meta.galleryScope === 'unit'
              ? meta.galleryScope
              : null;
          return {
            id: row.id,
            url: `/api/public/media/${row.id}`,
            position: row.position,
            unitId: row.unitId,
            ...(galleryScope ? { galleryScope } : {}),
          };
        });
    }

    return {
      id: property.id,
      kind: property.kind,
      category: property.category,
      nameAr: property.nameAr,
      nameEn: property.nameEn,
      descriptionAr: property.descriptionAr,
      descriptionEn: property.descriptionEn,
      defaultCurrency: property.defaultCurrency as CurrencyCode,
      status: property.status,
      serialNumber: property.serialNumber,
      organizationId: property.organizationId,
      ownerPartyId: property.ownerPartyId,
      ownerPartyName:
        profile?.showOwnerNameOnListing === true ? (ownerParty?.displayName ?? null) : null,
      showOwnerNameOnListing: Boolean(profile?.showOwnerNameOnListing),
      mapsUrl,
      latitude,
      longitude,
      profile: profile
        ? {
            furnishing:
              profile.furnishing === 'furnished' ||
              profile.furnishing === 'semi_furnished' ||
              profile.furnishing === 'unfurnished'
                ? profile.furnishing
                : 'unfurnished',
            parkingSpaces: profile.parkingSpaces,
            yearBuilt: profile.yearBuilt,
            builtUpAreaSquareMeters: profile.builtUpAreaSquareMeters,
            landAreaSquareMeters: profile.landAreaSquareMeters,
            showOwnerNameOnListing: Boolean(profile.showOwnerNameOnListing),
            notes: null,
          }
        : null,
      address: address
        ? {
            countryCode: address.countryCode,
            governorate: address.governorate,
            wilayat: address.wilayat,
            city: address.city,
            area: address.area,
            street: address.street,
          }
        : null,
      gallery,
      amenities: amenities.map((row) => ({
        id: row.id,
        code: row.code,
        labelAr: row.labelAr,
        labelEn: row.labelEn,
      })),
      documents: [],
      meters: [],
      ownership: [],
      units: unitRows.map((unit) => ({
        id: unit.id,
        code: unit.code,
        nameAr: unit.nameAr,
        nameEn: unit.nameEn,
        floor: unit.floor,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        majlis: unit.majlis,
        halls: unit.halls,
        kitchens: unit.kitchens,
        hasPool: unit.hasPool,
        areaSquareMeters: unit.areaSquareMeters,
        rentMinor: unit.rentMinor.toString(),
        salePriceMinor: unit.salePriceMinor?.toString() ?? null,
        depositMinor: unit.depositMinor?.toString() ?? null,
        currency: unit.currency as CurrencyCode,
        listingPurpose: unit.listingPurpose as 'rent' | 'sale' | 'both',
        publishWhenAvailable: unit.publishWhenAvailable,
        listingEnabled: unit.listingEnabled,
        listingSlug: unit.listingSlug,
        status: unit.status,
        occupancy: occupancyByUnit.get(unit.id) ?? 'available',
      })),
    };
  });
}

type InlineMeta = { storage?: string; dataBase64?: string };

/** Stream a property gallery image for the public marketing page. */
export async function loadPublicPropertyMediaBytes(
  assetId: string,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return null;
  const { db } = getDatabase();
  const asset = await db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
    await transaction.execute(sql`select set_config('app.public', 'true', true)`);
    const row = await transaction.query.mediaAssets.findFirst({
      where: and(
        eq(mediaAssets.id, assetId),
        eq(mediaAssets.processingStatus, 'ready'),
        eq(mediaAssets.scanStatus, 'clean'),
      ),
    });
    if (!row || !row.mimeType.startsWith('image/')) return null;
    if (row.byteSize > BigInt(12 * 1024 * 1024)) return null;
    const linked = await transaction.query.unitMedia.findFirst({
      where: eq(unitMedia.mediaAssetId, assetId),
    });
    if (!linked) return null;
    return row;
  });
  if (!asset) return null;

  const meta = (asset.metadata ?? {}) as InlineMeta;
  if (meta.storage === 'inline' && typeof meta.dataBase64 === 'string' && meta.dataBase64) {
    return { bytes: Buffer.from(meta.dataBase64, 'base64'), mimeType: asset.mimeType };
  }

  if (!s3Configured()) return null;
  const publicBucket = process.env.S3_BUCKET_PUBLIC?.trim();
  const privateBucket =
    process.env.S3_BUCKET_PRIVATE?.trim() || publicBucket || 'bhd-r-private';
  const bucket = asset.publicObjectKey && publicBucket ? publicBucket : privateBucket;
  const key = asset.publicObjectKey || asset.privateObjectKey;
  if (!key || key.startsWith('inline/')) return null;

  const client = new S3Client({
    region: process.env.S3_REGION?.trim() || 'auto',
    forcePathStyle: true,
    endpoint: process.env.S3_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });
  const result = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
  const body = result.Body;
  if (!body) return null;
  return {
    bytes: Buffer.from(await body.transformToByteArray()),
    mimeType: asset.mimeType,
  };
}
