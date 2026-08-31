import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, ne, isNull, sql } from 'drizzle-orm';
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
  idempotencyKeys,
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

const IDEMPOTENCY_ROUTE = 'POST:/api/owner/properties';

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

function requestHash(raw: unknown): string {
  return createHash('sha256').update(JSON.stringify(raw)).digest('hex');
}

/** Break-glass property create on Vercel → Neon (bypasses Nest/Render for writes). */
export async function createPropertyBundleOnNeon(
  claims: SessionClaims,
  raw: unknown,
  options: { idempotencyKey?: string | null } = {},
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

  const idemKey =
    typeof options.idempotencyKey === 'string' && options.idempotencyKey.trim().length >= 8
      ? options.idempotencyKey.trim().slice(0, 200)
      : null;
  const hash = requestHash(raw);

  return withinTenant(claims, async (transaction) => {
    if (idemKey) {
      const existing = await transaction.query.idempotencyKeys.findFirst({
        where: and(
          eq(idempotencyKeys.organizationId, claims.organizationId!),
          eq(idempotencyKeys.key, idemKey),
          eq(idempotencyKeys.route, IDEMPOTENCY_ROUTE),
        ),
      });
      if (existing?.responseBody && existing.responseStatus) {
        if (existing.requestHash !== hash) throw new Error('idempotency_payload_mismatch');
        return existing.responseBody as Record<string, unknown>;
      }
    }

    const owner = await transaction.query.parties.findFirst({
      where: and(
        eq(parties.id, input.property.ownerPartyId),
        eq(parties.organizationId, claims.organizationId!),
      ),
    });
    if (!owner) throw new Error('owner_not_found');

    const addr = input.property.address;
    const duplicate = await transaction
      .select({ id: properties.id })
      .from(properties)
      .innerJoin(addresses, eq(addresses.id, properties.addressId))
      .where(
        and(
          eq(properties.organizationId, claims.organizationId!),
          ne(properties.status, 'archived'),
          eq(properties.nameAr, input.property.nameAr),
          eq(addresses.governorate, addr.governorate),
          eq(addresses.wilayat, addr.wilayat),
          eq(addresses.city, addr.city),
        ),
      )
      .limit(1);
    if (duplicate[0]) throw new Error('duplicate_property');

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
          majlis: unit.majlis,
          halls: unit.halls,
          kitchens: unit.kitchens,
          hasPool: unit.hasPool,
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

    const result = {
      ...property,
      units: unitRows.map((unit) => ({
        ...unit,
        rentMinor: unit.rentMinor.toString(),
        salePriceMinor: unit.salePriceMinor?.toString() ?? null,
        depositMinor: unit.depositMinor?.toString() ?? null,
      })),
    };

    if (idemKey) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      await transaction
        .insert(idempotencyKeys)
        .values({
          organizationId: claims.organizationId!,
          key: idemKey,
          route: IDEMPOTENCY_ROUTE,
          requestHash: hash,
          responseStatus: 201,
          responseBody: result,
          lockedUntil: now,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [idempotencyKeys.organizationId, idempotencyKeys.key, idempotencyKeys.route],
          set: {
            requestHash: hash,
            responseStatus: 201,
            responseBody: result,
            lockedUntil: now,
            expiresAt,
          },
        });
    }

    return result;
  });
}

const updatePropertyBundleSchema = z.object({
  property: createPropertySchema.omit({ organizationId: true }),
  units: z
    .array(
      createUnitSchema.omit({ propertyId: true }).extend({
        id: z.string().uuid().optional(),
      }),
    )
    .min(1)
    .max(500),
});

/** Update property + address + units via Neon (edit wizard; no Nest full bundle yet). */
export async function updatePropertyBundleOnNeon(
  claims: SessionClaims,
  propertyId: string,
  raw: unknown,
  options: { idempotencyKey?: string | null } = {},
): Promise<Record<string, unknown>> {
  if (!claims.organizationId) throw new Error('organization_required');
  if (
    !claims.permissions.includes('property.update') ||
    !claims.permissions.includes('unit.update')
  ) {
    throw new Error('forbidden');
  }
  const input = updatePropertyBundleSchema.parse(raw);
  const idemRoute = `PATCH:/api/owner/properties/${propertyId}`;
  const idemKey =
    typeof options.idempotencyKey === 'string' && options.idempotencyKey.trim().length >= 8
      ? options.idempotencyKey.trim().slice(0, 200)
      : null;
  const hash = requestHash(raw);

  return withinTenant(claims, async (transaction) => {
    if (idemKey) {
      const existing = await transaction.query.idempotencyKeys.findFirst({
        where: and(
          eq(idempotencyKeys.organizationId, claims.organizationId!),
          eq(idempotencyKeys.key, idemKey),
          eq(idempotencyKeys.route, idemRoute),
        ),
      });
      if (existing?.responseBody && existing.responseStatus) {
        if (existing.requestHash !== hash) throw new Error('idempotency_payload_mismatch');
        return existing.responseBody as Record<string, unknown>;
      }
    }

    const property = await transaction.query.properties.findFirst({
      where: and(
        eq(properties.id, propertyId),
        eq(properties.organizationId, claims.organizationId!),
      ),
    });
    if (!property) throw new Error('property_not_found');
    if (property.status === 'archived') throw new Error('property_archived');

    const owner = await transaction.query.parties.findFirst({
      where: and(
        eq(parties.id, input.property.ownerPartyId),
        eq(parties.organizationId, claims.organizationId!),
      ),
    });
    if (!owner) throw new Error('owner_not_found');

    const addr = input.property.address;
    const duplicate = await transaction
      .select({ id: properties.id })
      .from(properties)
      .innerJoin(addresses, eq(addresses.id, properties.addressId))
      .where(
        and(
          eq(properties.organizationId, claims.organizationId!),
          ne(properties.status, 'archived'),
          ne(properties.id, propertyId),
          eq(properties.nameAr, input.property.nameAr),
          eq(addresses.governorate, addr.governorate),
          eq(addresses.wilayat, addr.wilayat),
          eq(addresses.city, addr.city),
        ),
      )
      .limit(1);
    if (duplicate[0]) throw new Error('duplicate_property');

    const lat = addr.latitude;
    const lon = addr.longitude;
    const { latitude: _lat, longitude: _lon, ...addressFields } = addr;
    await transaction
      .update(addresses)
      .set({
        ...addressFields,
        ...(typeof lat === 'number' && typeof lon === 'number'
          ? {
              location: sql`ST_GeogFromText(${`SRID=4326;POINT(${lon} ${lat})`})`,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(addresses.id, property.addressId),
          eq(addresses.organizationId, claims.organizationId!),
        ),
      );

    const propertyRows = await transaction
      .update(properties)
      .set({
        ownerPartyId: input.property.ownerPartyId,
        category: input.property.category,
        nameAr: input.property.nameAr,
        nameEn: input.property.nameEn,
        descriptionAr: input.property.descriptionAr ?? null,
        descriptionEn: input.property.descriptionEn ?? null,
        defaultCurrency: input.property.defaultCurrency,
        updatedAt: new Date(),
      })
      .where(
        and(eq(properties.id, propertyId), eq(properties.organizationId, claims.organizationId!)),
      )
      .returning({
        id: properties.id,
        serialNumber: properties.serialNumber,
        kind: properties.kind,
        status: properties.status,
      });
    const updated = propertyRows[0];
    if (!updated) throw new Error('update_failed');

    if (input.property.ownerPartyId !== property.ownerPartyId) {
      await transaction
        .update(propertyOwnershipInterests)
        .set({
          partyId: input.property.ownerPartyId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(propertyOwnershipInterests.propertyId, propertyId),
            eq(propertyOwnershipInterests.organizationId, claims.organizationId!),
            isNull(propertyOwnershipInterests.endsOn),
          ),
        );
    }

    if (input.property.profile) {
      const { managementFee, ...profileFields } = input.property.profile;
      const existingProfile = await transaction.query.propertyProfiles.findFirst({
        where: eq(propertyProfiles.propertyId, propertyId),
      });
      const profileValues = {
        ...profileFields,
        managementFeeMinor: managementFee ? BigInt(managementFee.amountMinor) : null,
        updatedAt: new Date(),
      };
      if (existingProfile) {
        await transaction
          .update(propertyProfiles)
          .set(profileValues)
          .where(eq(propertyProfiles.id, existingProfile.id));
      } else {
        await transaction.insert(propertyProfiles).values({
          organizationId: claims.organizationId!,
          propertyId,
          ...profileFields,
          managementFeeMinor: managementFee ? BigInt(managementFee.amountMinor) : null,
        });
      }
    }

    await transaction
      .delete(propertyAmenities)
      .where(
        and(
          eq(propertyAmenities.propertyId, propertyId),
          eq(propertyAmenities.organizationId, claims.organizationId!),
        ),
      );
    if (input.property.amenities.length) {
      await transaction.insert(propertyAmenities).values(
        input.property.amenities.map((amenity) => ({
          organizationId: claims.organizationId!,
          propertyId,
          ...amenity,
        })),
      );
    }

    const previousDocuments = await transaction
      .select()
      .from(propertyDocuments)
      .where(
        and(
          eq(propertyDocuments.propertyId, propertyId),
          eq(propertyDocuments.organizationId, claims.organizationId!),
        ),
      );
    const mediaByType = new Map(
      previousDocuments
        .filter((row) => row.mediaAssetId)
        .map((row) => [row.documentType, row.mediaAssetId] as const),
    );
    await transaction
      .delete(propertyDocuments)
      .where(
        and(
          eq(propertyDocuments.propertyId, propertyId),
          eq(propertyDocuments.organizationId, claims.organizationId!),
        ),
      );
    if (input.property.documents.length) {
      await transaction.insert(propertyDocuments).values(
        input.property.documents.map((document) => ({
          organizationId: claims.organizationId!,
          propertyId,
          mediaAssetId: mediaByType.get(document.documentType) ?? null,
          ...document,
        })),
      );
    }

    await transaction
      .delete(utilityMeters)
      .where(
        and(
          eq(utilityMeters.propertyId, propertyId),
          eq(utilityMeters.organizationId, claims.organizationId!),
        ),
      );
    if (input.property.meters.length) {
      const existingUnits = await transaction.query.units.findMany({
        where: and(
          eq(units.propertyId, propertyId),
          eq(units.organizationId, claims.organizationId!),
        ),
      });
      const unitsByCode = new Map(existingUnits.map((unit) => [unit.code, unit.id]));
      await transaction.insert(utilityMeters).values(
        input.property.meters.map(({ unitCode, ...meter }) => ({
          organizationId: claims.organizationId!,
          propertyId,
          unitId: unitCode ? (unitsByCode.get(unitCode) ?? null) : null,
          ...meter,
        })),
      );
    }

    const unitRows = [];
    for (const [index, unit] of input.units.entries()) {
      const patch = {
        code: unit.code,
        nameAr: unit.nameAr,
        nameEn: unit.nameEn,
        floor: unit.floor ?? null,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        majlis: unit.majlis,
        halls: unit.halls,
        kitchens: unit.kitchens,
        hasPool: unit.hasPool,
        areaSquareMeters: unit.areaSquareMeters ?? null,
        rentMinor: BigInt(unit.rent.amountMinor),
        salePriceMinor: unit.salePrice ? BigInt(unit.salePrice.amountMinor) : null,
        depositMinor: unit.deposit ? BigInt(unit.deposit.amountMinor) : null,
        currency: unit.rent.currency,
        minorUnit: currencyMinorUnits[unit.rent.currency],
        listingPurpose: unit.listingPurpose,
        publishWhenAvailable: unit.publishWhenAvailable,
        updatedAt: new Date(),
      };
      if (unit.id) {
        const rows = await transaction
          .update(units)
          .set(patch)
          .where(
            and(
              eq(units.id, unit.id),
              eq(units.propertyId, propertyId),
              eq(units.organizationId, claims.organizationId!),
            ),
          )
          .returning();
        if (rows[0]) {
          unitRows.push(rows[0]);
          const existingListing = await transaction.query.listings.findFirst({
            where: and(
              eq(listings.unitId, rows[0].id),
              eq(listings.organizationId, claims.organizationId!),
            ),
          });
          if (existingListing) {
            await transaction
              .update(listings)
              .set({
                enabled: unit.publishWhenAvailable,
                publishedAt: unit.publishWhenAvailable
                  ? (existingListing.publishedAt ?? new Date())
                  : null,
                updatedAt: new Date(),
              })
              .where(eq(listings.id, existingListing.id));
          } else {
            await transaction.insert(listings).values({
              organizationId: claims.organizationId!,
              unitId: rows[0].id,
              slug: `${slugify(input.property.nameEn)}-${slugify(unit.code)}-${rows[0].id.slice(0, 8)}`,
              enabled: unit.publishWhenAvailable,
              publishedAt: unit.publishWhenAvailable ? new Date() : null,
            });
          }
        }
      } else if (index === 0) {
        const existing = await transaction.query.units.findMany({
          where: and(
            eq(units.propertyId, propertyId),
            eq(units.organizationId, claims.organizationId!),
          ),
        });
        const first = existing[0];
        if (first) {
          const rows = await transaction
            .update(units)
            .set(patch)
            .where(eq(units.id, first.id))
            .returning();
          if (rows[0]) {
            unitRows.push(rows[0]);
            const existingListing = await transaction.query.listings.findFirst({
              where: and(
                eq(listings.unitId, rows[0].id),
                eq(listings.organizationId, claims.organizationId!),
              ),
            });
            if (existingListing) {
              await transaction
                .update(listings)
                .set({
                  enabled: unit.publishWhenAvailable,
                  publishedAt: unit.publishWhenAvailable
                    ? (existingListing.publishedAt ?? new Date())
                    : null,
                  updatedAt: new Date(),
                })
                .where(eq(listings.id, existingListing.id));
            } else {
              await transaction.insert(listings).values({
                organizationId: claims.organizationId!,
                unitId: rows[0].id,
                slug: `${slugify(input.property.nameEn)}-${slugify(unit.code)}-${rows[0].id.slice(0, 8)}`,
                enabled: unit.publishWhenAvailable,
                publishedAt: unit.publishWhenAvailable ? new Date() : null,
              });
            }
          }
        }
      }
    }

    // Publishing requires an active property (draft/inactive stays hidden on /properties).
    if (input.units.some((unit) => unit.publishWhenAvailable)) {
      await transaction
        .update(properties)
        .set({ status: 'active', updatedAt: new Date() })
        .where(
          and(
            eq(properties.id, propertyId),
            eq(properties.organizationId, claims.organizationId!),
          ),
        );
      await transaction
        .update(units)
        .set({ status: 'active', updatedAt: new Date() })
        .where(
          and(
            eq(units.propertyId, propertyId),
            eq(units.organizationId, claims.organizationId!),
            eq(units.publishWhenAvailable, true),
          ),
        );
    }

    await transaction.insert(outboxEvents).values({
      organizationId: claims.organizationId!,
      topic: 'property.updated',
      aggregateType: 'property',
      aggregateId: propertyId,
      payload: { via: 'vercel-neon-edit' },
    });

    const result = {
      id: updated.id,
      serialNumber: updated.serialNumber,
      kind: updated.kind,
      status: updated.status,
      units: unitRows.map((unit) => ({
        id: unit.id,
        code: unit.code,
        rentMinor: unit.rentMinor.toString(),
        salePriceMinor: unit.salePriceMinor?.toString() ?? null,
        depositMinor: unit.depositMinor?.toString() ?? null,
      })),
    };

    if (idemKey) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      await transaction
        .insert(idempotencyKeys)
        .values({
          organizationId: claims.organizationId!,
          key: idemKey,
          route: idemRoute,
          requestHash: hash,
          responseStatus: 200,
          responseBody: result,
          lockedUntil: now,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [idempotencyKeys.organizationId, idempotencyKeys.key, idempotencyKeys.route],
          set: {
            requestHash: hash,
            responseStatus: 200,
            responseBody: result,
            lockedUntil: now,
            expiresAt,
          },
        });
    }

    return result;
  });
}

/**
 * Heal publish flags → listings (edit used to update units only).
 * Call from owner Property 360 load so «عرض عند التوفر» actually appears on /properties.
 */
export async function ensurePublishedListingsMatchFlags(
  claims: SessionClaims,
  propertyId: string,
): Promise<void> {
  if (!claims.organizationId) return;
  await withinTenant(claims, async (transaction) => {
    const property = await transaction.query.properties.findFirst({
      where: and(
        eq(properties.id, propertyId),
        eq(properties.organizationId, claims.organizationId!),
      ),
    });
    if (!property || property.status === 'archived') return;

    const unitRows = await transaction.query.units.findMany({
      where: and(
        eq(units.propertyId, propertyId),
        eq(units.organizationId, claims.organizationId!),
      ),
    });

    let publishedAny = false;
    for (const unit of unitRows) {
      const existingListing = await transaction.query.listings.findFirst({
        where: and(
          eq(listings.unitId, unit.id),
          eq(listings.organizationId, claims.organizationId!),
        ),
      });
      if (unit.publishWhenAvailable) {
        publishedAny = true;
        if (existingListing) {
          if (!existingListing.enabled || !existingListing.publishedAt) {
            await transaction
              .update(listings)
              .set({
                enabled: true,
                publishedAt: existingListing.publishedAt ?? new Date(),
                updatedAt: new Date(),
              })
              .where(eq(listings.id, existingListing.id));
          }
        } else {
          await transaction.insert(listings).values({
            organizationId: claims.organizationId!,
            unitId: unit.id,
            slug: `${slugify(property.nameEn)}-${slugify(unit.code)}-${unit.id.slice(0, 8)}`,
            enabled: true,
            publishedAt: new Date(),
          });
        }
        if (unit.status !== 'active') {
          await transaction
            .update(units)
            .set({ status: 'active', updatedAt: new Date() })
            .where(eq(units.id, unit.id));
        }
      } else if (existingListing?.enabled) {
        await transaction
          .update(listings)
          .set({ enabled: false, publishedAt: null, updatedAt: new Date() })
          .where(eq(listings.id, existingListing.id));
      }
    }

    if (publishedAny && property.status !== 'active') {
      await transaction
        .update(properties)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(properties.id, propertyId));
    }
  });
}

export { propertyBundleSchema };
