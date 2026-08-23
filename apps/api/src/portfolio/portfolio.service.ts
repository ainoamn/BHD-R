import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  lte,
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
  properties,
  reservations,
  unitMedia,
  units,
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
import { DatabaseService } from '../database/database.service.js';

interface PropertyBundleInput {
  property: Omit<CreatePropertyInput, 'organizationId'>;
  units: Array<Omit<CreateUnitInput, 'propertyId'>>;
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
          ? `SRID=4326;POINT(${input.property.address.longitude} ${input.property.address.latitude})`
          : null;
      const addressRows = await transaction
        .insert(addresses)
        .values({
          organizationId: claims.organizationId!,
          ...input.property.address,
          location,
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
          status: 'active',
        })
        .returning();
      const property = propertyRows[0]!;
      const unitRows = await transaction
        .insert(units)
        .values(
          input.units.map((unit) => {
            if (
              unit.rent.currency !== input.property.defaultCurrency ||
              (unit.deposit && unit.deposit.currency !== unit.rent.currency)
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
              areaSquareMeters: unit.areaSquareMeters,
              rentMinor: BigInt(unit.rent.amountMinor),
              depositMinor: unit.deposit ? BigInt(unit.deposit.amountMinor) : null,
              currency: unit.rent.currency,
              minorUnit: currencyMinorUnits[unit.rent.currency],
              publishWhenAvailable: unit.publishWhenAvailable,
              status: 'active' as const,
            };
          }),
        )
        .returning();
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
          return {
            ...property,
            units: unitRows.map((unit) => ({
              ...unit,
              rentMinor: unit.rentMinor.toString(),
              depositMinor: unit.depositMinor?.toString() ?? null,
            })),
          };
        }),
      );
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
            .where(and(eq(leases.unitId, units.id), inArray(leases.status, ['draft', 'active']))),
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
          rentMinor: units.rentMinor,
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
          areaSquareMeters: row.areaSquareMeters,
          rent: { amountMinor: row.rentMinor.toString(), currency: row.currency },
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
          rentMinor: units.rentMinor,
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
        .where(and(eq(units.id, unitId), eq(listings.enabled, true)))
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
        areaSquareMeters: row.areaSquareMeters,
        rent: { amountMinor: row.rentMinor.toString(), currency: row.currency },
        deposit:
          row.depositMinor === null
            ? null
            : { amountMinor: row.depositMinor.toString(), currency: row.currency },
        available: true,
        images: images.flatMap((image) =>
          image.key
            ? [
                {
                  id: image.id,
                  url: publicAssetUrl(image.key),
                  ...((image.metadata as Record<string, unknown> | null)?.altAr
                    ? { altAr: String((image.metadata as Record<string, unknown>).altAr) }
                    : {}),
                  ...((image.metadata as Record<string, unknown> | null)?.altEn
                    ? { altEn: String((image.metadata as Record<string, unknown>).altEn) }
                    : {}),
                },
              ]
            : [],
        ),
      });
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
          rentMinor: units.rentMinor,
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
        .where(and(eq(properties.id, propertyId), eq(listings.enabled, true)))
        .orderBy(desc(listings.publishedAt));
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
          rent: { amountMinor: row.rentMinor.toString(), currency: row.currency },
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
