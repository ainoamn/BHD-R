import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  addresses,
  createDatabase,
  listings,
  parties,
  properties,
  propertyAmenities,
  propertyDocuments,
  propertyOwnershipInterests,
  propertyProfiles,
  units,
  utilityMeters,
  type Database,
} from '@bhd-r/db';
import type { CurrencyCode } from '@bhd-r/contracts';
import type { ManagedProperty } from '@/components/property-detail-manager';

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

    const [address, profile, amenities, meters, documents, ownership, unitRows] =
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
      ]);

    void profile;

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
      })),
      meters: meters.map((row) => ({
        id: row.id,
        utilityType: row.utilityType,
        meterNumber: row.meterNumber,
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
        areaSquareMeters: unit.areaSquareMeters,
        rentMinor: unit.rentMinor.toString(),
        salePriceMinor: unit.salePriceMinor?.toString() ?? null,
        depositMinor: unit.depositMinor?.toString() ?? null,
        currency: unit.currency as CurrencyCode,
        listingPurpose: unit.listingPurpose,
        publishWhenAvailable: unit.publishWhenAvailable,
        listingEnabled: unit.listingEnabled,
        listingSlug: unit.listingSlug,
        status: unit.status,
      })),
    };
  });
}
