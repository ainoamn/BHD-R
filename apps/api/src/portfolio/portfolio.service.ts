import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import {
  addresses,
  holds,
  leases,
  listings,
  maintenanceTickets,
  mediaAssets,
  outboxEvents,
  parties,
  partyRoles,
  properties,
  propertyAmenities,
  propertyDocuments,
  propertyOwnershipInterests,
  propertyProfiles,
  reservations,
  unitMedia,
  units,
  utilityMeters,
  viewingRequests,
} from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import {
  currencyMinorUnits,
  listingCollectionSchema,
  publicPropertyDetailSchema,
  publicUnitDetailSchema,
  type CreatePropertyInput,
  type CreateUnitInput,
  type ListingSearchInput,
} from '@bhd-r/contracts';
import { assertOrganizationEntitlement } from '../common/entitlements.js';
import { DatabaseService } from '../database/database.service.js';

interface PropertyBundleInput {
  property: Omit<CreatePropertyInput, 'organizationId'>;
  units: Array<Omit<CreateUnitInput, 'propertyId'>>;
}

interface PropertyUpdateBundleInput {
  property: Omit<CreatePropertyInput, 'organizationId'>;
  units: Array<Omit<CreateUnitInput, 'propertyId'> & { id?: string | undefined }>;
}

interface UpdateUnitInput {
  code?: string | undefined;
  nameAr?: string | undefined;
  nameEn?: string | undefined;
  floor?: string | null | undefined;
  bedrooms?: number | undefined;
  bathrooms?: number | undefined;
  majlis?: number | undefined;
  halls?: number | undefined;
  kitchens?: number | undefined;
  hasPool?: boolean | undefined;
  areaSquareMeters?: string | null | undefined;
  listingPurpose?: 'rent' | 'sale' | 'both' | undefined;
  rent?: CreateUnitInput['rent'] | undefined;
  salePrice?: CreateUnitInput['salePrice'] | null | undefined;
  deposit?: CreateUnitInput['deposit'] | null | undefined;
  status?: 'active' | 'inactive' | undefined;
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

function publicAssetUrl(key: string | null): string | null {
  if (!key) return null;
  const base =
    process.env.PUBLIC_MEDIA_BASE_URL ??
    `${(process.env.S3_ENDPOINT ?? 'http://localhost:9000').replace(/\/$/, '')}/${process.env.S3_BUCKET_PUBLIC ?? 'bhd-r-public'}`;
  return `${base.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function encodeCursor(value: { publishedAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ publishedAt: value.publishedAt.toISOString(), id: value.id }),
  ).toString('base64url');
}

function decodeCursor(value: string): { publishedAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      publishedAt?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed.publishedAt !== 'string' ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)
    )
      throw new Error();
    const publishedAt = new Date(parsed.publishedAt);
    if (Number.isNaN(publishedAt.valueOf())) throw new Error();
    return { publishedAt, id: parsed.id };
  } catch {
    throw new ConflictException('Invalid listing cursor');
  }
}

@Injectable()
export class PortfolioService {
  constructor(private readonly database: DatabaseService) {}

  createProperty(claims: SessionClaims, input: PropertyBundleInput) {
    if (input.property.kind === 'single_unit' && input.units.length !== 1)
      throw new ConflictException('A single-unit property must contain exactly one unit');
    if (input.property.kind === 'multi_unit' && input.units.length < 1)
      throw new ConflictException('A multi-unit property requires units');
    return this.database.withinTenant(claims, async (transaction) => {
      await assertOrganizationEntitlement(transaction, claims.organizationId!, 'properties', 1);
      await assertOrganizationEntitlement(
        transaction,
        claims.organizationId!,
        'units',
        input.units.length,
      );
      const owner = await transaction.query.parties.findFirst({
        where: and(
          eq(parties.id, input.property.ownerPartyId),
          eq(parties.organizationId, claims.organizationId!),
        ),
      });
      if (!owner) throw new NotFoundException('Property owner not found in this organization');
      const location =
        input.property.address.latitude !== undefined &&
        input.property.address.longitude !== undefined
          ? sql`ST_GeogFromText(${`SRID=4326;POINT(${input.property.address.longitude} ${input.property.address.latitude})`})`
          : null;
      const year = new Date().getUTCFullYear();
      const purpose = input.units[0]?.listingPurpose ?? 'rent';
      const typeCode = purpose === 'sale' ? 'PRP-S' : purpose === 'both' ? 'PRP-I' : 'PRP-R';
      const sequence = await transaction.execute(sql<{ allocated: bigint }>`
        insert into property_sequences (organization_id, year, type_code, next_value)
        values (${claims.organizationId!}, ${year}, ${typeCode}, 2)
        on conflict (organization_id, year, type_code)
        do update set next_value = property_sequences.next_value + 1
        returning next_value - 1 as allocated
      `);
      const seq = BigInt(String(sequence[0]!.allocated));
      const serialNumber = `BHD-${year}-${typeCode}-${seq.toString().padStart(4, '0')}`;
      const { latitude: _lat, longitude: _lon, ...addressFields } = input.property.address;
      const addressRows = await transaction
        .insert(addresses)
        .values({
          organizationId: claims.organizationId!,
          ...addressFields,
          ...(location ? { location } : {}),
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
        if (managementFee && managementFee.currency !== input.property.defaultCurrency)
          throw new ConflictException('Management fee currency must match property currency');
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
          input.units.map((unit) => {
            if (
              unit.rent.currency !== input.property.defaultCurrency ||
              (unit.deposit && unit.deposit.currency !== unit.rent.currency) ||
              (unit.salePrice && unit.salePrice.currency !== unit.rent.currency)
            )
              throw new ConflictException('Unit currencies must match property currency');
            return {
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
            };
          }),
        )
        .returning();
      if (input.property.meters.length) {
        const unitsByCode = new Map(unitRows.map((unit) => [unit.code, unit.id]));
        await transaction.insert(utilityMeters).values(
          input.property.meters.map(({ unitCode, ...meter }) => {
            const unitId = unitCode ? unitsByCode.get(unitCode) : undefined;
            if (unitCode && !unitId)
              throw new NotFoundException(`Utility meter unit code not found: ${unitCode}`);
            return {
              organizationId: claims.organizationId!,
              propertyId: property.id,
              unitId: unitId ?? null,
              ...meter,
            };
          }),
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
        payload: { kind: property.kind, unitCount: unitRows.length },
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

  listProperties(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select()
        .from(properties)
        .where(eq(properties.organizationId, claims.organizationId!))
        .orderBy(asc(properties.createdAt));
      return Promise.all(
        rows.map(async (property) => {
          const unitRows = await transaction
            .select()
            .from(units)
            .where(eq(units.propertyId, property.id));
          const [profile, amenities, meters, documents, ownership] = await Promise.all([
            transaction.query.propertyProfiles.findFirst({
              where: eq(propertyProfiles.propertyId, property.id),
            }),
            transaction
              .select()
              .from(propertyAmenities)
              .where(eq(propertyAmenities.propertyId, property.id)),
            transaction
              .select()
              .from(utilityMeters)
              .where(eq(utilityMeters.propertyId, property.id)),
            transaction
              .select()
              .from(propertyDocuments)
              .where(eq(propertyDocuments.propertyId, property.id)),
            transaction
              .select()
              .from(propertyOwnershipInterests)
              .where(eq(propertyOwnershipInterests.propertyId, property.id)),
          ]);
          return {
            ...property,
            profile: profile
              ? {
                  ...profile,
                  managementFeeMinor: profile.managementFeeMinor?.toString() ?? null,
                }
              : null,
            amenities,
            meters,
            documents,
            ownership,
            units: unitRows.map((unit) => ({
              ...unit,
              rentMinor: unit.rentMinor.toString(),
              salePriceMinor: unit.salePriceMinor?.toString() ?? null,
              depositMinor: unit.depositMinor?.toString() ?? null,
            })),
          };
        }),
      );
    });
  }

  getProperty(claims: SessionClaims, propertyId: string) {
    return this.database.withinTenant(claims, async (transaction) => {
      const property = await transaction.query.properties.findFirst({
        where: and(
          eq(properties.id, propertyId),
          eq(properties.organizationId, claims.organizationId!),
        ),
      });
      if (!property) throw new NotFoundException('Property not found');
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
        ]);
      return {
        ...property,
        address,
        profile: profile
          ? {
              ...profile,
              managementFeeMinor: profile.managementFeeMinor?.toString() ?? null,
            }
          : null,
        amenities,
        meters,
        documents,
        ownership,
        units: unitRows.map((unit) => ({
          ...unit,
          rentMinor: unit.rentMinor.toString(),
          salePriceMinor: unit.salePriceMinor?.toString() ?? null,
          depositMinor: unit.depositMinor?.toString() ?? null,
        })),
      };
    });
  }

  updateProperty(claims: SessionClaims, propertyId: string, input: PropertyUpdateBundleInput) {
    if (input.property.kind === 'single_unit' && input.units.length !== 1)
      throw new ConflictException('A single-unit property must contain exactly one unit');
    if (input.property.kind === 'multi_unit' && input.units.length < 1)
      throw new ConflictException('A multi-unit property requires units');
    return this.database.withinTenant(claims, async (transaction) => {
      const property = await transaction.query.properties.findFirst({
        where: and(
          eq(properties.id, propertyId),
          eq(properties.organizationId, claims.organizationId!),
        ),
      });
      if (!property) throw new NotFoundException('Property not found');
      if (property.status === 'archived')
        throw new ConflictException('Archived properties cannot be edited');

      const owner = await transaction.query.parties.findFirst({
        where: and(
          eq(parties.id, input.property.ownerPartyId),
          eq(parties.organizationId, claims.organizationId!),
        ),
      });
      if (!owner) throw new NotFoundException('Property owner not found in this organization');

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
      if (duplicate[0])
        throw new ConflictException('A property with the same name and address already exists');

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
        .returning();
      const updated = propertyRows[0]!;

      if (input.property.ownerPartyId !== property.ownerPartyId) {
        await transaction
          .update(propertyOwnershipInterests)
          .set({ partyId: input.property.ownerPartyId, updatedAt: new Date() })
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
        if (managementFee && managementFee.currency !== input.property.defaultCurrency)
          throw new ConflictException('Management fee currency must match property currency');
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
        if (
          unit.rent.currency !== input.property.defaultCurrency ||
          (unit.deposit && unit.deposit.currency !== unit.rent.currency) ||
          (unit.salePrice && unit.salePrice.currency !== unit.rent.currency)
        )
          throw new ConflictException('Unit currencies must match property currency');
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
        const syncListing = async (unitRow: (typeof units.$inferSelect)) => {
          const existingListing = await transaction.query.listings.findFirst({
            where: and(
              eq(listings.unitId, unitRow.id),
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
              unitId: unitRow.id,
              slug: `${slugify(input.property.nameEn)}-${slugify(unit.code)}-${unitRow.id.slice(0, 8)}`,
              enabled: unit.publishWhenAvailable,
              publishedAt: unit.publishWhenAvailable ? new Date() : null,
            });
          }
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
            await syncListing(rows[0]);
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
              await syncListing(rows[0]);
            }
          }
        }
      }

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
        payload: { via: 'nest-portfolio', unitCount: unitRows.length },
      });

      return {
        ...updated,
        units: unitRows.map((unit) => ({
          ...unit,
          rentMinor: unit.rentMinor.toString(),
          salePriceMinor: unit.salePriceMinor?.toString() ?? null,
          depositMinor: unit.depositMinor?.toString() ?? null,
        })),
      };
    });
  }

  updatePropertyDeposit(
    claims: SessionClaims,
    propertyId: string,
    input: { amountMinor: string; currency?: string },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const property = await transaction.query.properties.findFirst({
        where: and(
          eq(properties.id, propertyId),
          eq(properties.organizationId, claims.organizationId!),
        ),
      });
      if (!property) throw new NotFoundException('Property not found');
      if (property.status === 'archived')
        throw new ConflictException('Archived properties cannot be edited');
      const unitRows = await transaction
        .select({ id: units.id, currency: units.currency })
        .from(units)
        .where(
          and(eq(units.propertyId, propertyId), eq(units.organizationId, claims.organizationId!)),
        );
      if (!unitRows.length) throw new NotFoundException('No units on property');
      if (input.currency && unitRows.some((row) => row.currency !== input.currency)) {
        throw new ConflictException('Deposit currency must match unit currency');
      }
      await transaction
        .update(units)
        .set({
          depositMinor: BigInt(input.amountMinor),
          ...(input.currency ? { currency: input.currency } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(eq(units.propertyId, propertyId), eq(units.organizationId, claims.organizationId!)),
        );
      return { ok: true as const, unitCount: unitRows.length };
    });
  }

  addUnit(claims: SessionClaims, propertyId: string, input: Omit<CreateUnitInput, 'propertyId'>) {
    return this.database.withinTenant(claims, async (transaction) => {
      await assertOrganizationEntitlement(transaction, claims.organizationId!, 'units', 1);
      const property = await transaction.query.properties.findFirst({
        where: and(
          eq(properties.id, propertyId),
          eq(properties.organizationId, claims.organizationId!),
        ),
      });
      if (!property || property.status === 'archived')
        throw new NotFoundException('Active property not found');
      if (property.kind === 'single_unit')
        throw new ConflictException('Additional units require a multi-unit property');
      this.assertUnitCurrency(property.defaultCurrency, input);
      const rows = await transaction
        .insert(units)
        .values({
          organizationId: claims.organizationId!,
          propertyId,
          code: input.code,
          nameAr: input.nameAr,
          nameEn: input.nameEn,
          floor: input.floor,
          bedrooms: input.bedrooms,
          bathrooms: input.bathrooms,
          majlis: input.majlis,
          halls: input.halls,
          kitchens: input.kitchens,
          hasPool: input.hasPool,
          areaSquareMeters: input.areaSquareMeters,
          rentMinor: BigInt(input.rent.amountMinor),
          salePriceMinor: input.salePrice ? BigInt(input.salePrice.amountMinor) : null,
          depositMinor: input.deposit ? BigInt(input.deposit.amountMinor) : null,
          currency: input.rent.currency,
          minorUnit: currencyMinorUnits[input.rent.currency],
          listingPurpose: input.listingPurpose,
          publishWhenAvailable: input.publishWhenAvailable,
          status: 'active',
        })
        .returning();
      const unit = rows[0]!;
      await transaction.insert(listings).values({
        organizationId: claims.organizationId!,
        unitId: unit.id,
        slug: `${slugify(property.nameEn)}-${slugify(unit.code)}-${unit.id.slice(0, 8)}`,
        enabled: input.publishWhenAvailable,
        publishedAt: input.publishWhenAvailable ? new Date() : null,
      });
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'unit.created',
        aggregateType: 'unit',
        aggregateId: unit.id,
        payload: { propertyId },
      });
      return {
        ...unit,
        rentMinor: unit.rentMinor.toString(),
        salePriceMinor: unit.salePriceMinor?.toString() ?? null,
        depositMinor: unit.depositMinor?.toString() ?? null,
      };
    });
  }

  updateUnit(claims: SessionClaims, unitId: string, input: UpdateUnitInput) {
    return this.database.withinTenant(claims, async (transaction) => {
      const unit = await transaction.query.units.findFirst({
        where: and(eq(units.id, unitId), eq(units.organizationId, claims.organizationId!)),
      });
      if (!unit) throw new NotFoundException('Unit not found');
      const currency = input.rent?.currency ?? unit.currency;
      if (
        currency !== unit.currency ||
        (input.salePrice && input.salePrice.currency !== unit.currency) ||
        (input.deposit && input.deposit.currency !== unit.currency)
      )
        throw new ConflictException('Unit currency cannot be changed independently');
      const { rent, salePrice, deposit, ...scalarPatch } = input;
      const rows = await transaction
        .update(units)
        .set({
          ...scalarPatch,
          ...(rent ? { rentMinor: BigInt(rent.amountMinor) } : {}),
          ...(salePrice !== undefined
            ? { salePriceMinor: salePrice ? BigInt(salePrice.amountMinor) : null }
            : {}),
          ...(deposit !== undefined
            ? { depositMinor: deposit ? BigInt(deposit.amountMinor) : null }
            : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(units.id, unitId), eq(units.organizationId, claims.organizationId!)))
        .returning();
      if (input.status === 'inactive') {
        await transaction
          .update(listings)
          .set({ enabled: false, publishedAt: null, updatedAt: new Date() })
          .where(
            and(eq(listings.unitId, unitId), eq(listings.organizationId, claims.organizationId!)),
          );
      }
      const updated = rows[0]!;
      return {
        ...updated,
        rentMinor: updated.rentMinor.toString(),
        salePriceMinor: updated.salePriceMinor?.toString() ?? null,
        depositMinor: updated.depositMinor?.toString() ?? null,
      };
    });
  }

  archiveProperty(claims: SessionClaims, propertyId: string) {
    return this.database.withinTenant(claims, async (transaction) => {
      const activeLease = await transaction
        .select({ id: leases.id })
        .from(leases)
        .innerJoin(units, eq(units.id, leases.unitId))
        .where(
          and(
            eq(units.propertyId, propertyId),
            eq(leases.organizationId, claims.organizationId!),
            inArray(leases.status, ['draft', 'active', 'cancel_requested', 'clearance_pending']),
          ),
        )
        .limit(1);
      if (activeLease[0])
        throw new ConflictException('Property with an active or draft lease cannot be archived');
      const rows = await transaction
        .update(properties)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(
          and(
            eq(properties.id, propertyId),
            eq(properties.organizationId, claims.organizationId!),
            ne(properties.status, 'archived'),
          ),
        )
        .returning({ id: properties.id, status: properties.status });
      if (!rows[0]) throw new NotFoundException('Active property not found');
      await transaction
        .update(units)
        .set({ publishWhenAvailable: false, status: 'inactive', updatedAt: new Date() })
        .where(
          and(eq(units.propertyId, propertyId), eq(units.organizationId, claims.organizationId!)),
        );
      await transaction
        .update(listings)
        .set({ enabled: false, publishedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(listings.organizationId, claims.organizationId!),
            sql`${listings.unitId} IN (SELECT id FROM units WHERE property_id = ${propertyId})`,
          ),
        );
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'property.archived',
        aggregateType: 'property',
        aggregateId: propertyId,
        payload: {},
      });
      return rows[0];
    });
  }

  restoreProperty(claims: SessionClaims, propertyId: string) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .update(properties)
        .set({ status: 'active', updatedAt: new Date() })
        .where(
          and(
            eq(properties.id, propertyId),
            eq(properties.organizationId, claims.organizationId!),
            eq(properties.status, 'archived'),
          ),
        )
        .returning({ id: properties.id, status: properties.status });
      if (!rows[0]) throw new NotFoundException('Archived property not found');
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'property.restored',
        aggregateType: 'property',
        aggregateId: propertyId,
        payload: { listingsRepublished: false },
      });
      return rows[0];
    });
  }

  purgeProperty(claims: SessionClaims, propertyId: string) {
    return this.database.withinTenant(claims, async (transaction) => {
      const property = await transaction.query.properties.findFirst({
        where: and(
          eq(properties.id, propertyId),
          eq(properties.organizationId, claims.organizationId!),
        ),
      });
      if (!property) throw new NotFoundException('Property not found');
      if (property.status !== 'archived') {
        throw new ConflictException('Only archived properties can be permanently deleted');
      }

      const unitRows = await transaction
        .select({ id: units.id })
        .from(units)
        .where(
          and(eq(units.propertyId, propertyId), eq(units.organizationId, claims.organizationId!)),
        );
      const unitIds = unitRows.map((row) => row.id);

      if (unitIds.length) {
        const leaseRow = await transaction
          .select({ id: leases.id })
          .from(leases)
          .where(
            and(
              eq(leases.organizationId, claims.organizationId!),
              inArray(leases.unitId, unitIds),
            ),
          )
          .limit(1);
        if (leaseRow[0]) {
          throw new ConflictException('Cannot purge property with lease history');
        }

        await transaction
          .delete(listings)
          .where(
            and(
              eq(listings.organizationId, claims.organizationId!),
              inArray(listings.unitId, unitIds),
            ),
          );
      }

      await transaction
        .delete(propertyAmenities)
        .where(
          and(
            eq(propertyAmenities.propertyId, propertyId),
            eq(propertyAmenities.organizationId, claims.organizationId!),
          ),
        );
      await transaction
        .delete(propertyDocuments)
        .where(
          and(
            eq(propertyDocuments.propertyId, propertyId),
            eq(propertyDocuments.organizationId, claims.organizationId!),
          ),
        );
      await transaction
        .delete(propertyOwnershipInterests)
        .where(
          and(
            eq(propertyOwnershipInterests.propertyId, propertyId),
            eq(propertyOwnershipInterests.organizationId, claims.organizationId!),
          ),
        );
      await transaction
        .delete(propertyProfiles)
        .where(
          and(
            eq(propertyProfiles.propertyId, propertyId),
            eq(propertyProfiles.organizationId, claims.organizationId!),
          ),
        );
      await transaction
        .delete(utilityMeters)
        .where(
          and(
            eq(utilityMeters.propertyId, propertyId),
            eq(utilityMeters.organizationId, claims.organizationId!),
          ),
        );

      if (unitIds.length) {
        await transaction
          .delete(units)
          .where(
            and(eq(units.organizationId, claims.organizationId!), inArray(units.id, unitIds)),
          );
      }

      await transaction
        .delete(properties)
        .where(
          and(
            eq(properties.id, propertyId),
            eq(properties.organizationId, claims.organizationId!),
          ),
        );

      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'property.purged',
        aggregateType: 'property',
        aggregateId: propertyId,
        payload: {},
      });

      return { id: propertyId, purged: true as const };
    });
  }

  async setListing(claims: SessionClaims, unitId: string, enabled: boolean) {
    return this.database.withinTenant(claims, async (transaction) => {
      const unit = await transaction.query.units.findFirst({
        where: and(eq(units.id, unitId), eq(units.organizationId, claims.organizationId!)),
      });
      if (!unit) throw new NotFoundException('Unit not found');
      await transaction
        .update(units)
        .set({ publishWhenAvailable: enabled, updatedAt: new Date() })
        .where(eq(units.id, unitId));
      const rows = await transaction
        .update(listings)
        .set({ enabled, publishedAt: enabled ? new Date() : null, updatedAt: new Date() })
        .where(eq(listings.unitId, unitId))
        .returning();
      return rows[0];
    });
  }

  private assertUnitCurrency(
    propertyCurrency: string,
    input: Omit<CreateUnitInput, 'propertyId'>,
  ): void {
    if (
      input.rent.currency !== propertyCurrency ||
      (input.deposit && input.deposit.currency !== input.rent.currency) ||
      (input.salePrice && input.salePrice.currency !== input.rent.currency)
    )
      throw new ConflictException('Unit currencies must match property currency');
  }

  searchPublic(input: ListingSearchInput) {
    return this.database.asPublic(async (transaction) => {
      const conditions = [
        eq(listings.enabled, true),
        isNotNull(listings.publishedAt),
        eq(units.publishWhenAvailable, true),
        eq(units.status, 'active'),
        eq(properties.status, 'active'),
        eq(addresses.countryCode, input.countryCode),
        notExists(
          transaction
            .select({ id: holds.id })
            .from(holds)
            .where(
              and(
                eq(holds.unitId, units.id),
                eq(holds.status, 'active'),
                gt(holds.expiresAt, new Date()),
              ),
            ),
        ),
        notExists(
          transaction
            .select({ id: reservations.id })
            .from(reservations)
            .where(
              and(
                eq(reservations.unitId, units.id),
                inArray(reservations.status, ['pending', 'confirmed']),
                gt(reservations.expiresAt, new Date()),
              ),
            ),
        ),
        notExists(
          transaction
            .select({ id: leases.id })
            .from(leases)
            .where(and(eq(leases.unitId, units.id), inArray(leases.status, ['draft', 'active', 'cancel_requested', 'clearance_pending']))),
        ),
        notExists(
          transaction
            .select({ id: maintenanceTickets.id })
            .from(maintenanceTickets)
            .where(
              and(
                eq(maintenanceTickets.unitId, units.id),
                eq(maintenanceTickets.blocksAvailability, true),
                inArray(maintenanceTickets.status, ['open', 'assigned', 'in_progress']),
              ),
            ),
        ),
      ];
      if (input.governorate) conditions.push(eq(addresses.governorate, input.governorate));
      if (input.category) conditions.push(eq(properties.category, input.category));
      if (input.bedrooms !== undefined) conditions.push(eq(units.bedrooms, input.bedrooms));
      if (input.currency) conditions.push(eq(units.currency, input.currency));
      if (input.listingPurpose)
        conditions.push(inArray(units.listingPurpose, [input.listingPurpose, 'both']));
      if (input.minRentMinor !== undefined)
        conditions.push(sql`${units.rentMinor} >= ${input.minRentMinor}`);
      if (input.maxRentMinor !== undefined)
        conditions.push(lte(units.rentMinor, input.maxRentMinor));
      if (input.cursor) {
        const cursor = decodeCursor(input.cursor);
        conditions.push(
          or(
            lt(listings.publishedAt, cursor.publishedAt),
            and(eq(listings.publishedAt, cursor.publishedAt), lt(units.id, cursor.id)),
          )!,
        );
      }
      const rows = await transaction
        .select({
          id: listings.id,
          slug: listings.slug,
          propertyId: properties.id,
          unitId: units.id,
          category: properties.category,
          unitNameAr: units.nameAr,
          unitNameEn: units.nameEn,
          propertyNameAr: properties.nameAr,
          propertyNameEn: properties.nameEn,
          bedrooms: units.bedrooms,
          bathrooms: units.bathrooms,
          areaSquareMeters: units.areaSquareMeters,
          listingPurpose: units.listingPurpose,
          rentMinor: units.rentMinor,
          salePriceMinor: units.salePriceMinor,
          currency: units.currency,
          governorate: addresses.governorate,
          wilayat: addresses.wilayat,
          publishedAt: listings.publishedAt,
          coverObjectKey: sql<
            string | null
          >`(select ma.public_object_key from unit_media um join media_assets ma on ma.id = um.media_asset_id where um.unit_id = ${units.id} and ma.processing_status = 'ready' and ma.scan_status = 'clean' order by um.position asc limit 1)`,
        })
        .from(listings)
        .innerJoin(units, eq(units.id, listings.unitId))
        .innerJoin(properties, eq(properties.id, units.propertyId))
        .innerJoin(addresses, eq(addresses.id, properties.addressId))
        .where(and(...conditions))
        .orderBy(desc(listings.publishedAt), desc(units.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      return listingCollectionSchema.parse({
        data: page.map((row) => ({
          id: row.id,
          slug: row.slug,
          propertyId: row.propertyId,
          unitId: row.unitId,
          propertyNameAr: row.propertyNameAr,
          propertyNameEn: row.propertyNameEn,
          unitNameAr: row.unitNameAr,
          unitNameEn: row.unitNameEn,
          category: row.category,
          governorate: row.governorate,
          wilayat: row.wilayat,
          bedrooms: row.bedrooms,
          bathrooms: row.bathrooms,
          areaSquareMeters: row.areaSquareMeters == null ? null : String(row.areaSquareMeters),
          listingPurpose: row.listingPurpose,
          rent: { amountMinor: row.rentMinor.toString(), currency: row.currency },
          salePrice:
            row.salePriceMinor === null
              ? null
              : { amountMinor: row.salePriceMinor.toString(), currency: row.currency },
          coverImageUrl: publicAssetUrl(row.coverObjectKey),
          available: true,
          publishedAt: row.publishedAt!.toISOString(),
        })),
        pagination: {
          hasMore,
          nextCursor:
            hasMore && page.at(-1)?.publishedAt
              ? encodeCursor({ publishedAt: page.at(-1)!.publishedAt!, id: page.at(-1)!.unitId })
              : null,
        },
      });
    });
  }

  async publicBySlug(slug: string) {
    const result = await this.database.asPublic((transaction) =>
      transaction
        .select({ unitId: listings.unitId })
        .from(listings)
        .where(and(eq(listings.slug, slug), eq(listings.enabled, true)))
        .limit(1),
    );
    if (!result[0]) throw new NotFoundException('Listing unavailable');
    return this.publicUnitById(result[0].unitId);
  }

  async publicUnitById(unitId: string) {
    return this.database.asPublic(async (transaction) => {
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
            notExists(
              transaction
                .select({ id: holds.id })
                .from(holds)
                .where(
                  and(
                    eq(holds.unitId, units.id),
                    eq(holds.status, 'active'),
                    gt(holds.expiresAt, new Date()),
                  ),
                ),
            ),
            notExists(
              transaction
                .select({ id: reservations.id })
                .from(reservations)
                .where(
                  and(
                    eq(reservations.unitId, units.id),
                    inArray(reservations.status, ['pending', 'confirmed']),
                    gt(reservations.expiresAt, new Date()),
                  ),
                ),
            ),
            notExists(
              transaction
                .select({ id: leases.id })
                .from(leases)
                .where(
                  and(eq(leases.unitId, units.id), inArray(leases.status, ['draft', 'active', 'cancel_requested', 'clearance_pending'])),
                ),
            ),
            notExists(
              transaction
                .select({ id: maintenanceTickets.id })
                .from(maintenanceTickets)
                .where(
                  and(
                    eq(maintenanceTickets.unitId, units.id),
                    eq(maintenanceTickets.blocksAvailability, true),
                    inArray(maintenanceTickets.status, ['open', 'assigned', 'in_progress']),
                  ),
                ),
            ),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundException('Unit unavailable');
      const images = await transaction
        .select({
          id: mediaAssets.id,
          key: mediaAssets.publicObjectKey,
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
        .orderBy(unitMedia.position)
        .limit(40);
      return publicUnitDetailSchema.parse({
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
        category: row.category,
        governorate: row.governorate,
        wilayat: row.wilayat,
        city: row.city,
        bedrooms: row.bedrooms,
        bathrooms: row.bathrooms,
        areaSquareMeters: row.areaSquareMeters == null ? null : String(row.areaSquareMeters),
        listingPurpose: row.listingPurpose,
        rent: { amountMinor: row.rentMinor.toString(), currency: row.currency },
        salePrice:
          row.salePriceMinor === null
            ? null
            : { amountMinor: row.salePriceMinor.toString(), currency: row.currency },
        deposit:
          row.depositMinor === null
            ? null
            : { amountMinor: row.depositMinor.toString(), currency: row.currency },
        available: true,
        images: images.flatMap((image) => {
          const meta = (image.metadata ?? {}) as Record<string, unknown>;
          const inline =
            meta.storage === 'inline' ||
            (typeof image.key === 'string' && image.key.startsWith('inline/'));
          const webOrigin = (
            process.env.PUBLIC_WEB_ORIGIN ??
            process.env.WEB_ORIGIN ??
            ''
          ).replace(/\/$/, '');
          const url = inline
            ? webOrigin
              ? `${webOrigin}/api/public/media/${image.id}`
              : null
            : publicAssetUrl(image.key);
          if (!url) return [];
          return [
            {
              id: image.id,
              url,
              ...(typeof meta.altAr === 'string' ? { altAr: meta.altAr } : {}),
              ...(typeof meta.altEn === 'string' ? { altEn: meta.altEn } : {}),
            },
          ];
        }),
      });
    });
  }

  async createPublicViewingRequest(input: {
    submissionId: string;
    unitId: string;
    displayName: string;
    email: string;
    phone?: string | undefined;
    preferredAt?: string | undefined;
    notes?: string | undefined;
    locale: 'ar' | 'en';
    consent: true;
    website?: string | undefined;
  }) {
    if (input.website) return { accepted: true };
    return this.database.asSystem(async (transaction) => {
      const now = new Date();
      const rows = await transaction
        .select({ organizationId: listings.organizationId })
        .from(listings)
        .innerJoin(units, eq(units.id, listings.unitId))
        .innerJoin(properties, eq(properties.id, units.propertyId))
        .where(
          and(
            eq(units.id, input.unitId),
            eq(listings.enabled, true),
            isNotNull(listings.publishedAt),
            eq(units.publishWhenAvailable, true),
            eq(units.status, 'active'),
            eq(properties.status, 'active'),
            notExists(
              transaction
                .select({ id: holds.id })
                .from(holds)
                .where(
                  and(
                    eq(holds.unitId, units.id),
                    eq(holds.status, 'active'),
                    gt(holds.expiresAt, now),
                  ),
                ),
            ),
            notExists(
              transaction
                .select({ id: reservations.id })
                .from(reservations)
                .where(
                  and(
                    eq(reservations.unitId, units.id),
                    inArray(reservations.status, ['pending', 'confirmed']),
                    gt(reservations.expiresAt, now),
                  ),
                ),
            ),
            notExists(
              transaction
                .select({ id: leases.id })
                .from(leases)
                .where(
                  and(eq(leases.unitId, units.id), inArray(leases.status, ['draft', 'active', 'cancel_requested', 'clearance_pending'])),
                ),
            ),
          ),
        )
        .limit(1);
      const listing = rows[0];
      if (!listing) throw new ConflictException('Unit is no longer available');

      const reference = `WEB-${input.submissionId}`;
      const previous = await transaction.query.viewingRequests.findFirst({
        where: and(
          eq(viewingRequests.organizationId, listing.organizationId),
          eq(viewingRequests.reference, reference),
        ),
      });
      if (previous)
        return { accepted: true, reference: previous.reference, status: previous.status };

      const normalizedEmail = input.email.trim().toLowerCase();
      const existingParty = await transaction.query.parties.findFirst({
        where: and(
          eq(parties.organizationId, listing.organizationId),
          eq(parties.email, normalizedEmail),
        ),
      });
      const party =
        existingParty ??
        (
          await transaction
            .insert(parties)
            .values({
              organizationId: listing.organizationId,
              type: 'person',
              displayName: input.displayName.trim(),
              email: normalizedEmail,
              phone: input.phone?.trim() || null,
              metadata: { source: 'public_listing', preferredLocale: input.locale },
            })
            .onConflictDoNothing()
            .returning()
        )[0] ??
        (await transaction.query.parties.findFirst({
          where: and(
            eq(parties.organizationId, listing.organizationId),
            eq(parties.email, normalizedEmail),
          ),
        }));
      if (!party) throw new ConflictException('Could not register the viewing request');
      await transaction
        .insert(partyRoles)
        .values({
          organizationId: listing.organizationId,
          partyId: party.id,
          roleKey: 'prospect',
        })
        .onConflictDoUpdate({
          target: [partyRoles.organizationId, partyRoles.partyId, partyRoles.roleKey],
          set: { status: 'active', updatedAt: now },
        });

      const inserted = await transaction
        .insert(viewingRequests)
        .values({
          organizationId: listing.organizationId,
          reference,
          unitId: input.unitId,
          prospectPartyId: party.id,
          channel: 'website',
          status: 'requested',
          preferredAt: input.preferredAt ? new Date(input.preferredAt) : null,
          notes: input.notes?.trim() || null,
        })
        .onConflictDoNothing()
        .returning();
      const viewing =
        inserted[0] ??
        (await transaction.query.viewingRequests.findFirst({
          where: and(
            eq(viewingRequests.organizationId, listing.organizationId),
            eq(viewingRequests.reference, reference),
          ),
        }));
      if (!viewing) throw new ConflictException('Could not register the viewing request');
      if (inserted[0]) {
        await transaction.insert(outboxEvents).values({
          organizationId: listing.organizationId,
          topic: 'viewing.created',
          aggregateType: 'viewing_request',
          aggregateId: viewing.id,
          payload: { unitId: input.unitId, source: 'public_listing' },
        });
      }
      return { accepted: true, reference: viewing.reference, status: viewing.status };
    });
  }

  async createPublicBookingCheckout(input: {
    submissionId: string;
    unitId: string;
    displayName: string;
    email: string;
    locale: 'ar' | 'en';
    consent: true;
    website?: string | undefined;
  }) {
    if (input.website) {
      return {
        reservationId: input.submissionId,
        sessionReference: `bk_honeypot_${input.submissionId.replaceAll('-', '').slice(0, 20)}`,
        amountMinor: '0',
        currency: 'OMR',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      };
    }
    return this.database.asSystem(async (transaction) => {
      await transaction.execute(sql`
        update holds
        set status = 'expired', updated_at = now()
        where status = 'active' and expires_at <= now() and unit_id = ${input.unitId}::uuid
      `);
      await transaction.execute(sql`
        update reservations
        set status = 'expired', updated_at = now()
        where status in ('pending', 'confirmed') and expires_at <= now() and unit_id = ${input.unitId}::uuid
      `);

      const listingRows = await transaction
        .select({
          organizationId: listings.organizationId,
          unitId: units.id,
          depositMinor: units.depositMinor,
          rentMinor: units.rentMinor,
          currency: units.currency,
          listingPurpose: units.listingPurpose,
        })
        .from(listings)
        .innerJoin(units, eq(units.id, listings.unitId))
        .innerJoin(properties, eq(properties.id, units.propertyId))
        .where(
          and(
            eq(units.id, input.unitId),
            eq(listings.enabled, true),
            isNotNull(listings.publishedAt),
            eq(units.publishWhenAvailable, true),
            eq(units.status, 'active'),
            eq(properties.status, 'active'),
          ),
        )
        .limit(1);
      const unit = listingRows[0];
      if (!unit) throw new ConflictException('Unit is no longer available');
      if (!unit.depositMinor || unit.depositMinor <= 0n)
        throw new ConflictException('Booking deposit is not set for this unit');

      const normalizedEmail = input.email.trim().toLowerCase();
      const sessionReference = `bk_${createHash('sha256')
        .update(`${normalizedEmail}:${input.unitId}:${input.submissionId}`)
        .digest('hex')
        .slice(0, 28)}`;

      const existingRows = await transaction
        .select({
          id: reservations.id,
          termsSnapshot: reservations.termsSnapshot,
          expiresAt: reservations.expiresAt,
        })
        .from(reservations)
        .where(
          and(
            eq(reservations.organizationId, unit.organizationId),
            eq(reservations.unitId, input.unitId),
            eq(reservations.status, 'pending'),
          ),
        )
        .limit(40);
      const existing = existingRows.find((row) => {
        const snap = (row.termsSnapshot ?? {}) as Record<string, unknown>;
        return snap.checkoutSessionReference === sessionReference;
      });
      if (existing) {
        return {
          reservationId: existing.id,
          sessionReference,
          amountMinor: unit.depositMinor.toString(),
          currency: unit.currency,
          expiresAt: existing.expiresAt.toISOString(),
        };
      }

      const now = new Date();
      const activeHold = await transaction
        .select({ id: holds.id })
        .from(holds)
        .where(
          and(
            eq(holds.unitId, input.unitId),
            eq(holds.status, 'active'),
            gt(holds.expiresAt, now),
          ),
        )
        .limit(1);
      const activeReservation = await transaction
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.unitId, input.unitId),
            inArray(reservations.status, ['pending', 'confirmed']),
            gt(reservations.expiresAt, now),
          ),
        )
        .limit(1);
      const activeLease = await transaction
        .select({ id: leases.id })
        .from(leases)
        .where(
          and(
            eq(leases.unitId, input.unitId),
            inArray(leases.status, ['draft', 'active', 'cancel_requested', 'clearance_pending']),
          ),
        )
        .limit(1);
      if (activeHold[0] || activeReservation[0] || activeLease[0])
        throw new ConflictException('Unit is no longer available');

      const existingParty = await transaction.query.parties.findFirst({
        where: and(
          eq(parties.organizationId, unit.organizationId),
          eq(parties.email, normalizedEmail),
        ),
      });
      const party =
        existingParty ??
        (
          await transaction
            .insert(parties)
            .values({
              organizationId: unit.organizationId,
              type: 'person',
              displayName: input.displayName.trim(),
              email: normalizedEmail,
              metadata: {
                source: 'public_booking_checkout',
                preferredLocale: input.locale,
              },
            })
            .onConflictDoNothing()
            .returning()
        )[0] ??
        (await transaction.query.parties.findFirst({
          where: and(
            eq(parties.organizationId, unit.organizationId),
            eq(parties.email, normalizedEmail),
          ),
        }));
      if (!party) throw new ConflictException('Could not register the booking prospect');

      await transaction
        .insert(partyRoles)
        .values({
          organizationId: unit.organizationId,
          partyId: party.id,
          roleKey: 'prospect',
        })
        .onConflictDoUpdate({
          target: [partyRoles.organizationId, partyRoles.partyId, partyRoles.roleKey],
          set: { status: 'active', updatedAt: now },
        });

      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      await transaction.insert(holds).values({
        organizationId: unit.organizationId,
        unitId: input.unitId,
        prospectPartyId: party.id,
        status: 'active',
        expiresAt,
        note: 'Public booking checkout hold',
      });

      const reservationRows = await transaction
        .insert(reservations)
        .values({
          organizationId: unit.organizationId,
          unitId: input.unitId,
          tenantPartyId: party.id,
          status: 'pending',
          expiresAt,
          rentMinor: unit.rentMinor,
          currency: unit.currency,
          termsSnapshot: {
            listingPurpose: unit.listingPurpose,
            depositMinor: unit.depositMinor.toString(),
            currency: unit.currency,
            checkoutSessionReference: sessionReference,
            awaitingPublicDepositPayment: true,
            capturedAt: new Date().toISOString(),
            idempotencyKey: input.submissionId,
            via: 'nest-public',
          },
        })
        .returning({ id: reservations.id });

      await transaction.insert(outboxEvents).values({
        organizationId: unit.organizationId,
        topic: 'reservation.created',
        aggregateType: 'reservation',
        aggregateId: reservationRows[0]!.id,
        payload: {
          unitId: input.unitId,
          source: 'public_booking_checkout',
          sessionReference,
        },
      });

      return {
        reservationId: reservationRows[0]!.id,
        sessionReference,
        amountMinor: unit.depositMinor.toString(),
        currency: unit.currency,
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  async publicPropertyById(propertyId: string) {
    return this.database.asPublic(async (transaction) => {
      const propertyRows = await transaction
        .select({
          id: properties.id,
          nameAr: properties.nameAr,
          nameEn: properties.nameEn,
          descriptionAr: properties.descriptionAr,
          descriptionEn: properties.descriptionEn,
          governorate: addresses.governorate,
          wilayat: addresses.wilayat,
        })
        .from(properties)
        .innerJoin(addresses, eq(addresses.id, properties.addressId))
        .where(eq(properties.id, propertyId))
        .limit(1);
      const property = propertyRows[0];
      if (!property) throw new NotFoundException('Property unavailable');
      const unitRows = await transaction
        .select({
          id: listings.id,
          slug: listings.slug,
          propertyId: properties.id,
          unitId: units.id,
          category: properties.category,
          propertyNameAr: properties.nameAr,
          propertyNameEn: properties.nameEn,
          unitNameAr: units.nameAr,
          unitNameEn: units.nameEn,
          bedrooms: units.bedrooms,
          bathrooms: units.bathrooms,
          areaSquareMeters: units.areaSquareMeters,
          listingPurpose: units.listingPurpose,
          rentMinor: units.rentMinor,
          salePriceMinor: units.salePriceMinor,
          currency: units.currency,
          governorate: addresses.governorate,
          wilayat: addresses.wilayat,
          publishedAt: listings.publishedAt,
          coverObjectKey: sql<
            string | null
          >`(select ma.public_object_key from unit_media um join media_assets ma on ma.id = um.media_asset_id where um.unit_id = ${units.id} and ma.processing_status = 'ready' and ma.scan_status = 'clean' order by um.position asc limit 1)`,
        })
        .from(listings)
        .innerJoin(units, eq(units.id, listings.unitId))
        .innerJoin(properties, eq(properties.id, units.propertyId))
        .innerJoin(addresses, eq(addresses.id, properties.addressId))
        .where(
          and(
            eq(properties.id, propertyId),
            eq(listings.enabled, true),
            isNotNull(listings.publishedAt),
            eq(units.publishWhenAvailable, true),
            eq(units.status, 'active'),
            eq(properties.status, 'active'),
            notExists(
              transaction
                .select({ id: holds.id })
                .from(holds)
                .where(
                  and(
                    eq(holds.unitId, units.id),
                    eq(holds.status, 'active'),
                    gt(holds.expiresAt, new Date()),
                  ),
                ),
            ),
            notExists(
              transaction
                .select({ id: reservations.id })
                .from(reservations)
                .where(
                  and(
                    eq(reservations.unitId, units.id),
                    inArray(reservations.status, ['pending', 'confirmed']),
                    gt(reservations.expiresAt, new Date()),
                  ),
                ),
            ),
            notExists(
              transaction
                .select({ id: leases.id })
                .from(leases)
                .where(
                  and(eq(leases.unitId, units.id), inArray(leases.status, ['draft', 'active', 'cancel_requested', 'clearance_pending'])),
                ),
            ),
            notExists(
              transaction
                .select({ id: maintenanceTickets.id })
                .from(maintenanceTickets)
                .where(
                  and(
                    eq(maintenanceTickets.unitId, units.id),
                    eq(maintenanceTickets.blocksAvailability, true),
                    inArray(maintenanceTickets.status, ['open', 'assigned', 'in_progress']),
                  ),
                ),
            ),
          ),
        )
        .orderBy(desc(listings.publishedAt));
      if (unitRows.length === 0) throw new NotFoundException('Property unavailable');
      return publicPropertyDetailSchema.parse({
        ...property,
        units: unitRows.map((row) => ({
          id: row.id,
          slug: row.slug,
          propertyId: row.propertyId,
          unitId: row.unitId,
          category: row.category,
          propertyNameAr: row.propertyNameAr,
          propertyNameEn: row.propertyNameEn,
          unitNameAr: row.unitNameAr,
          unitNameEn: row.unitNameEn,
          bedrooms: row.bedrooms,
          bathrooms: row.bathrooms,
          areaSquareMeters: row.areaSquareMeters,
          listingPurpose: row.listingPurpose,
          rent: { amountMinor: row.rentMinor.toString(), currency: row.currency },
          salePrice:
            row.salePriceMinor === null
              ? null
              : { amountMinor: row.salePriceMinor.toString(), currency: row.currency },
          governorate: row.governorate,
          wilayat: row.wilayat,
          coverImageUrl: publicAssetUrl(row.coverObjectKey),
          available: true,
          publishedAt: row.publishedAt!.toISOString(),
        })),
      });
    });
  }
}
