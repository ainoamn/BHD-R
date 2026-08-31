import 'server-only';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  addresses,
  createDatabase,
  listings,
  mediaAssets,
  parties,
  properties,
  propertyAmenities,
  propertyDocuments,
  propertyOwnershipInterests,
  propertyProfiles,
  unitMedia,
  units,
  utilityMeters,
  type Database,
} from '@bhd-r/db';
import type { CurrencyCode } from '@bhd-r/contracts';
import type { ManagedProperty } from '@/components/property-detail-manager';
import { googleMapsLinkFromCoords } from '@/lib/parse-google-maps-url';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRPropertyWriteDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRPropertyWriteDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRPropertyWriteDb = { db };
  }
  return globalForDb.__bhdRPropertyWriteDb;
}

function extractMapsUrl(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const match = notes.match(/Google Maps:\s*(https?:\/\/\S+)/i);
  return match?.[1]?.replace(/[.,;]+$/, '') ?? null;
}

/**
 * Public CDN URL only when PUBLIC_MEDIA_BASE_URL is a real browser-reachable base.
 * Never use S3_ENDPOINT (R2 API host) — browsers cannot load private object API URLs.
 */
function publicMediaUrl(objectKey: string | null | undefined): string | null {
  if (!objectKey || objectKey.startsWith('inline/')) return null;
  const base = process.env.PUBLIC_MEDIA_BASE_URL?.replace(/\/$/, '');
  if (!base || base.includes('example.com') || base.includes('r2.cloudflarestorage.com')) {
    return null;
  }
  const bucket = process.env.S3_BUCKET_PUBLIC?.trim();
  return bucket ? `${base}/${bucket}/${objectKey}` : `${base}/${objectKey}`;
}

/** Load property 360 payload from Neon (when Nest/Render is down). */
export async function loadManagedPropertyFromNeon(
  organizationId: string,
  propertyId: string,
  viewer: { userId: string; partyId?: string | null },
): Promise<ManagedProperty | null> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.organization_id', ${organizationId}, true)`,
    );
    await transaction.execute(sql`select set_config('app.user_id', ${viewer.userId}, true)`);
    await transaction.execute(
      sql`select set_config('app.party_id', ${viewer.partyId ?? ''}, true)`,
    );
    await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
    await transaction.execute(sql`select set_config('app.is_tenant', 'false', true)`);
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);

    const property = await transaction.query.properties.findFirst({
      where: and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)),
    });
    if (!property) return null;

    const [address, profile, amenities, meters, documents, ownership, unitRows, coords] =
      await Promise.all([
        transaction.query.addresses.findFirst({ where: eq(addresses.id, property.addressId) }),
        transaction.query.propertyProfiles.findFirst({
          where: eq(propertyProfiles.propertyId, property.id),
        }),
        transaction
          .select()
          .from(propertyAmenities)
          .where(eq(propertyAmenities.propertyId, property.id)),
        transaction.select().from(utilityMeters).where(eq(utilityMeters.propertyId, property.id)),
        transaction
          .select()
          .from(propertyDocuments)
          .where(eq(propertyDocuments.propertyId, property.id)),
        transaction
          .select({
            id: propertyOwnershipInterests.id,
            partyId: propertyOwnershipInterests.partyId,
            role: propertyOwnershipInterests.role,
            shareBasisPoints: propertyOwnershipInterests.shareBasisPoints,
            startsOn: propertyOwnershipInterests.startsOn,
            endsOn: propertyOwnershipInterests.endsOn,
            partyName: parties.displayName,
          })
          .from(propertyOwnershipInterests)
          .innerJoin(parties, eq(parties.id, propertyOwnershipInterests.partyId))
          .where(eq(propertyOwnershipInterests.propertyId, property.id)),
        transaction
          .select({
            id: units.id,
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
            listingPurpose: units.listingPurpose,
            publishWhenAvailable: units.publishWhenAvailable,
            status: units.status,
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
    let gallery: ManagedProperty['gallery'] = [];
    if (unitIds.length) {
      const mediaRows = await transaction
        .select({
          id: mediaAssets.id,
          publicObjectKey: mediaAssets.publicObjectKey,
          privateObjectKey: mediaAssets.privateObjectKey,
          mimeType: mediaAssets.mimeType,
          position: unitMedia.position,
          unitId: unitMedia.unitId,
          metadata: mediaAssets.metadata,
        })
        .from(unitMedia)
        .innerJoin(mediaAssets, eq(mediaAssets.id, unitMedia.mediaAssetId))
        .where(and(eq(unitMedia.organizationId, organizationId), inArray(unitMedia.unitId, unitIds)))
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
            // Owner portal always streams via authenticated BFF (works for R2 + Neon inline).
            url: publicMediaUrl(row.publicObjectKey) ?? `/api/owner/media/${row.id}`,
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
      mapsUrl,
      latitude,
      longitude,
      profile: profile
        ? {
            deedNumber: profile.deedNumber,
            plotNumber: profile.plotNumber,
            municipalityNumber: profile.municipalityNumber,
            landAreaSquareMeters: profile.landAreaSquareMeters,
            builtUpAreaSquareMeters: profile.builtUpAreaSquareMeters,
            yearBuilt: profile.yearBuilt,
            parkingSpaces: profile.parkingSpaces,
            furnishing: profile.furnishing as
              | 'unfurnished'
              | 'semi_furnished'
              | 'furnished',
            managementStartedOn: profile.managementStartedOn,
            managementFeeMinor: profile.managementFeeMinor?.toString() ?? null,
            notes: profile.notes,
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
      documents: documents.map((row) => ({
        id: row.id,
        documentType: row.documentType,
        documentNumber: row.documentNumber,
        verificationStatus: row.verificationStatus,
        expiresOn: row.expiresOn,
        mediaAssetId: row.mediaAssetId,
        notes: row.notes,
      })),
      meters: meters.map((row) => ({
        id: row.id,
        utilityType: row.utilityType,
        meterNumber: row.meterNumber,
        unitId: row.unitId,
      })),
      ownership: ownership.map((row) => ({
        id: row.id,
        partyId: row.partyId,
        role: row.role,
        shareBasisPoints: row.shareBasisPoints,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        partyName: row.partyName,
      })),
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
      })),
    } as ManagedProperty;
  });
}
