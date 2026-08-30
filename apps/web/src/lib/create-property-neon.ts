import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { currencyMinorUnits } from '@bhd-r/contracts';
import {
  createPropertySchema,
  createUnitSchema,
} from '@bhd-r/contracts';
import type { SessionClaims } from '@bhd-r/authz';
import {
  addresses,
  createDatabase,
  listings,
  outboxEvents,
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

const propertyBundleSchema = z.object({
  property: createPropertySchema.omit({ organizationId: true }),
  units: z
    .array(createUnitSchema.omit({ propertyId: true }))
    .min(1)
    .max(500),
});

export type PropertyBundleInput = z.infer<typeof propertyBundleSchema>;

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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

async function withinTenant<T>(
  claims: SessionClaims,
  work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.organization_id', ${claims.organizationId ?? ''}, true)`,
    );
    await transaction.execute(sql`select set_config('app.user_id', ${claims.sub}, true)`);
    await transaction.execute(
      sql`select set_config('app.party_id', ${claims.partyId ?? ''}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.platform_admin', ${String(claims.roles.includes('platform_admin'))}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.is_tenant', ${String(claims.roles.includes('tenant'))}, true)`,
    );
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);
    return work(transaction);
  });
}

/** Break-glass property create on Vercel → Neon (bypasses Nest/Render for writes). */
export async function createPropertyBundleOnNeon(
  claims: SessionClaims,
  raw: unknown,
): Promise<Record<string, unknown>> {
  if (!claims.organizationId) throw new Error('organization_required');
  if (
    !claims.permissions.includes('property.create') ||
    !claims.permissions.includes('unit.create')
  ) {
    throw new Error('forbidden');
  }
  const input = propertyBundleSchema.parse(raw);
  if (input.property.kind === 'single_unit' && input.units.length !== 1) {
    throw new Error('single_unit_requires_one_unit');
  }
  if (input.property.kind === 'multi_unit' && input.units.length < 1) {
    throw new Error('multi_unit_requires_units');
  }

  return withinTenant(claims, async (transaction) => {
    const owner = await transaction.query.parties.findFirst({
      where: and(
        eq(parties.id, input.property.ownerPartyId),
        eq(parties.organizationId, claims.organizationId!),
      ),
    });
    if (!owner) throw new Error('owner_not_found');

    const year = new Date().getUTCFullYear();
    const purpose = input.units[0]?.listingPurpose ?? 'rent';
    const typeCode = purpose === 'sale' ? 'PRP-S' : purpose === 'both' ? 'PRP-I' : 'PRP-R';
    let serialNumber = `BHD-${year}-${typeCode}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    try {
      const sequence = await transaction.execute(sql<{ allocated: bigint }>`
        insert into property_sequences (organization_id, year, type_code, next_value)
        values (${claims.organizationId!}, ${year}, ${typeCode}, 2)
        on conflict (organization_id, year, type_code)
        do update set next_value = property_sequences.next_value + 1
        returning next_value - 1 as allocated
      `);
      const seq = BigInt(String(sequence[0]!.allocated));
      serialNumber = `BHD-${year}-${typeCode}-${seq.toString().padStart(4, '0')}`;
    } catch {
      // Migration 0012 may be missing — keep random serial.
    }

    const lat = input.property.address.latitude;
    const lon = input.property.address.longitude;
    const { latitude: _lat, longitude: _lon, ...addressFields } = input.property.address;

    const addressRows = await transaction
      .insert(addresses)
      .values({
        organizationId: claims.organizationId!,
        ...addressFields,
        ...(typeof lat === 'number' && typeof lon === 'number'
          ? {
              location: sql`ST_GeogFromText(${`SRID=4326;POINT(${lon} ${lat})`})`,
            }
          : {}),
      })
      .returning();
    const address = addressRows[0]!;

    const propertyRows = await transaction
      .insert(properties)
      .values({
        organizationId: claims.organizationId!,
        ownerPartyId: input.property.ownerPartyId,
        addressId: address.id,
        kind: input.property.kind,
        category: input.property.category,
        nameAr: input.property.nameAr,
        nameEn: input.property.nameEn,
        descriptionAr: input.property.descriptionAr,
        descriptionEn: input.property.descriptionEn,
        defaultCurrency: input.property.defaultCurrency,
        serialNumber,
        status: 'active',
      })
      .returning();
    const property = propertyRows[0]!;

    await transaction.insert(propertyOwnershipInterests).values({
      organizationId: claims.organizationId!,
      propertyId: property.id,
      partyId: input.property.ownerPartyId,
      role: 'owner',
      shareBasisPoints: 10_000,
    });

    if (input.property.profile) {
      const { managementFee, ...profile } = input.property.profile;
      await transaction.insert(propertyProfiles).values({
        organizationId: claims.organizationId!,
        propertyId: property.id,
        ...profile,
        managementFeeMinor: managementFee ? BigInt(managementFee.amountMinor) : null,
      });
    }
    if (input.property.amenities.length) {
      await transaction.insert(propertyAmenities).values(
        input.property.amenities.map((amenity) => ({
          organizationId: claims.organizationId!,
          propertyId: property.id,
          ...amenity,
        })),
      );
    }
    if (input.property.documents.length) {
      await transaction.insert(propertyDocuments).values(
        input.property.documents.map((document) => ({
          organizationId: claims.organizationId!,
          propertyId: property.id,
          ...document,
        })),
      );
    }

    const unitRows = await transaction
      .insert(units)
      .values(
        input.units.map((unit) => ({
          organizationId: claims.organizationId!,
          propertyId: property.id,
          code: unit.code,
          nameAr: unit.nameAr,
          nameEn: unit.nameEn,
          floor: unit.floor,
          bedrooms: unit.bedrooms,
          bathrooms: unit.bathrooms,
          areaSquareMeters: unit.areaSquareMeters,
          rentMinor: BigInt(unit.rent.amountMinor),
          salePriceMinor: unit.salePrice ? BigInt(unit.salePrice.amountMinor) : null,
          depositMinor: unit.deposit ? BigInt(unit.deposit.amountMinor) : null,
          currency: unit.rent.currency,
          minorUnit: currencyMinorUnits[unit.rent.currency],
          listingPurpose: unit.listingPurpose,
          publishWhenAvailable: unit.publishWhenAvailable,
          status: 'active' as const,
        })),
      )
      .returning();

    if (input.property.meters.length) {
      const unitsByCode = new Map(unitRows.map((unit) => [unit.code, unit.id]));
      await transaction.insert(utilityMeters).values(
        input.property.meters.map(({ unitCode, ...meter }) => ({
          organizationId: claims.organizationId!,
          propertyId: property.id,
          unitId: unitCode ? (unitsByCode.get(unitCode) ?? null) : null,
          ...meter,
        })),
      );
    }

    for (const [position, unit] of unitRows.entries()) {
      await transaction.insert(listings).values({
        organizationId: claims.organizationId!,
        unitId: unit.id,
        slug: `${slugify(input.property.nameEn)}-${slugify(unit.code)}-${unit.id.slice(0, 8)}`,
        enabled: unit.publishWhenAvailable,
        publishedAt: unit.publishWhenAvailable ? new Date() : null,
      });
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'unit.created',
        aggregateType: 'unit',
        aggregateId: unit.id,
        payload: { propertyId: property.id, position },
      });
    }
    await transaction.insert(outboxEvents).values({
      organizationId: claims.organizationId!,
      topic: 'property.created',
      aggregateType: 'property',
      aggregateId: property.id,
      payload: { kind: property.kind, unitCount: unitRows.length, via: 'vercel-neon' },
    });

    return {
      ...property,
      units: unitRows.map((unit) => ({
        ...unit,
        rentMinor: unit.rentMinor.toString(),
        salePriceMinor: unit.salePriceMinor?.toString() ?? null,
        depositMinor: unit.depositMinor?.toString() ?? null,
      })),
    };
  });
}

export { propertyBundleSchema };
