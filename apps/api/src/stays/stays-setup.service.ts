import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  outboxEvents,
  properties,
  stayProfiles,
  stayPublicListings,
  stayRatePlans,
  stayUnitTypes,
  units,
} from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import type {
  CreateStayProfilesInput,
  CreateStayUnitTypeInput,
  StaySetupContext,
  UpdateStayProfileInput,
  UpsertStayPublicListingInput,
  UpsertStayRatePlanInput,
} from '@bhd-r/contracts';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';
import { StaysInventoryService } from './stays-inventory.service.js';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

@Injectable()
export class StaysSetupService {
  constructor(
    private readonly database: DatabaseService,
    private readonly inventory: StaysInventoryService,
  ) {}

  async getContext(claims: SessionClaims, propertyId: string): Promise<StaySetupContext> {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      const [property] = await transaction
        .select({
          id: properties.id,
          nameAr: properties.nameAr,
          nameEn: properties.nameEn,
          defaultCurrency: properties.defaultCurrency,
        })
        .from(properties)
        .where(
          and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)),
        )
        .limit(1);
      if (!property) throw new NotFoundException('Property not found');

      const unitRows = await transaction
        .select({
          id: units.id,
          code: units.code,
          nameAr: units.nameAr,
          nameEn: units.nameEn,
          bedrooms: units.bedrooms,
          bathrooms: units.bathrooms,
        })
        .from(units)
        .where(and(eq(units.propertyId, propertyId), eq(units.organizationId, organizationId)))
        .orderBy(asc(units.code));

      const profileRows =
        unitRows.length === 0
          ? []
          : await transaction
              .select({
                unitId: stayProfiles.unitId,
                id: stayProfiles.id,
                publishStatus: stayProfiles.publishStatus,
              })
              .from(stayProfiles)
              .where(
                and(
                  eq(stayProfiles.organizationId, organizationId),
                  inArray(
                    stayProfiles.unitId,
                    unitRows.map((row) => row.id),
                  ),
                ),
              );

      const profileByUnit = new Map(profileRows.map((row) => [row.unitId, row]));

      const unitTypeRows = await transaction
        .select({
          id: stayUnitTypes.id,
          code: stayUnitTypes.code,
          nameAr: stayUnitTypes.nameAr,
          nameEn: stayUnitTypes.nameEn,
          maxGuests: stayUnitTypes.maxGuests,
        })
        .from(stayUnitTypes)
        .where(
          and(
            eq(stayUnitTypes.propertyId, propertyId),
            eq(stayUnitTypes.organizationId, organizationId),
          ),
        )
        .orderBy(asc(stayUnitTypes.code));

      const listingRows = await transaction
        .select({
          id: stayPublicListings.id,
          unitTypeId: stayPublicListings.unitTypeId,
          slug: stayPublicListings.slug,
          titleAr: stayPublicListings.titleAr,
          titleEn: stayPublicListings.titleEn,
          enabled: stayPublicListings.enabled,
          publishedAt: stayPublicListings.publishedAt,
        })
        .from(stayPublicListings)
        .where(
          and(
            eq(stayPublicListings.propertyId, propertyId),
            eq(stayPublicListings.organizationId, organizationId),
          ),
        );

      return {
        propertyId: property.id,
        propertyNameAr: property.nameAr,
        propertyNameEn: property.nameEn,
        defaultCurrency: property.defaultCurrency,
        units: unitRows.map((unit) => {
          const profile = profileByUnit.get(unit.id);
          return {
            id: unit.id,
            code: unit.code,
            nameAr: unit.nameAr,
            nameEn: unit.nameEn,
            bedrooms: unit.bedrooms,
            bathrooms: unit.bathrooms,
            profileId: profile?.id ?? null,
            publishStatus:
              (profile?.publishStatus as StaySetupContext['units'][number]['publishStatus']) ??
              null,
          };
        }),
        unitTypes: unitTypeRows,
        listings: listingRows.map((listing) => ({
          id: listing.id,
          unitTypeId: listing.unitTypeId,
          slug: listing.slug,
          titleAr: listing.titleAr,
          titleEn: listing.titleEn,
          enabled: listing.enabled,
          publishedAt: listing.publishedAt?.toISOString() ?? null,
        })),
      };
    });
  }

  async createUnitType(claims: SessionClaims, input: CreateStayUnitTypeInput) {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      await this.assertProperty(transaction, organizationId, input.propertyId);

      const [created] = await transaction
        .insert(stayUnitTypes)
        .values({
          organizationId,
          propertyId: input.propertyId,
          code: input.code,
          nameAr: input.nameAr,
          nameEn: input.nameEn,
          maxAdults: input.maxAdults,
          maxChildren: input.maxChildren,
          maxGuests: input.maxGuests,
          bedrooms: input.bedrooms,
          beds: input.beds,
          bathrooms: input.bathrooms,
          status: 'active',
        })
        .returning();

      return created;
    });
  }

  async createProfiles(claims: SessionClaims, input: CreateStayProfilesInput) {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      const property = await this.assertProperty(transaction, organizationId, input.propertyId);

      const [unitType] = await transaction
        .select({ id: stayUnitTypes.id, maxGuests: stayUnitTypes.maxGuests })
        .from(stayUnitTypes)
        .where(
          and(
            eq(stayUnitTypes.id, input.unitTypeId),
            eq(stayUnitTypes.organizationId, organizationId),
            eq(stayUnitTypes.propertyId, input.propertyId),
          ),
        )
        .limit(1);
      if (!unitType) throw new NotFoundException('Stay unit type not found');

      const unitRows = await transaction
        .select({ id: units.id })
        .from(units)
        .where(
          and(
            eq(units.organizationId, organizationId),
            eq(units.propertyId, input.propertyId),
            inArray(units.id, input.unitIds),
          ),
        );
      if (unitRows.length !== input.unitIds.length) {
        throw new ConflictException('One or more units are invalid for this property');
      }

      const currency = input.currency ?? property.defaultCurrency;
      const maxGuests = input.maxGuests ?? unitType.maxGuests;
      const maxAdults = input.maxAdults ?? Math.min(maxGuests, 2);
      const maxChildren = input.maxChildren ?? 0;
      const now = new Date();
      const created: Array<{ id: string; unitId: string }> = [];

      for (const unitId of input.unitIds) {
        const [existing] = await transaction
          .select({ id: stayProfiles.id })
          .from(stayProfiles)
          .where(
            and(eq(stayProfiles.organizationId, organizationId), eq(stayProfiles.unitId, unitId)),
          )
          .limit(1);

        if (existing) {
          const [updated] = await transaction
            .update(stayProfiles)
            .set({
              unitTypeId: input.unitTypeId,
              maxAdults,
              maxChildren,
              maxGuests,
              minNights: input.minNights,
              maxNights: input.maxNights,
              instantBook: input.instantBook,
              currency,
              checkInFrom: input.checkInFrom ?? null,
              checkInUntil: input.checkInUntil ?? null,
              checkOutUntil: input.checkOutUntil ?? null,
              updatedAt: now,
            })
            .where(eq(stayProfiles.id, existing.id))
            .returning({ id: stayProfiles.id, unitId: stayProfiles.unitId });
          if (updated) created.push(updated);
          continue;
        }

        const [inserted] = await transaction
          .insert(stayProfiles)
          .values({
            organizationId,
            unitId,
            unitTypeId: input.unitTypeId,
            enabled: false,
            publishStatus: 'draft',
            instantBook: input.instantBook,
            currency,
            minorUnit: currency === 'OMR' || currency === 'BHD' || currency === 'KWD' ? 3 : 2,
            maxAdults,
            maxChildren,
            maxGuests,
            minNights: input.minNights,
            maxNights: input.maxNights,
            checkInFrom: input.checkInFrom ?? '15:00',
            checkInUntil: input.checkInUntil ?? '22:00',
            checkOutUntil: input.checkOutUntil ?? '11:00',
          })
          .returning({ id: stayProfiles.id, unitId: stayProfiles.unitId });
        if (inserted) created.push(inserted);
      }

      return { profiles: created };
    });
  }

  async updateProfile(claims: SessionClaims, profileId: string, input: UpdateStayProfileInput) {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      const [profile] = await transaction
        .select({ id: stayProfiles.id })
        .from(stayProfiles)
        .where(
          and(eq(stayProfiles.id, profileId), eq(stayProfiles.organizationId, organizationId)),
        )
        .limit(1);
      if (!profile) throw new NotFoundException('Stay profile not found');

      const [updated] = await transaction
        .update(stayProfiles)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(stayProfiles.id, profileId))
        .returning();

      return updated;
    });
  }

  async upsertRatePlan(
    claims: SessionClaims,
    profileId: string,
    input: UpsertStayRatePlanInput,
  ) {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      const [profile] = await transaction
        .select({ id: stayProfiles.id, currency: stayProfiles.currency })
        .from(stayProfiles)
        .where(
          and(eq(stayProfiles.id, profileId), eq(stayProfiles.organizationId, organizationId)),
        )
        .limit(1);
      if (!profile) throw new NotFoundException('Stay profile not found');
      if (profile.currency !== input.currency) {
        throw new ConflictException('Rate plan currency must match stay profile currency');
      }

      const [existing] = await transaction
        .select({ id: stayRatePlans.id })
        .from(stayRatePlans)
        .where(
          and(
            eq(stayRatePlans.organizationId, organizationId),
            eq(stayRatePlans.stayProfileId, profileId),
            eq(stayRatePlans.code, 'base'),
          ),
        )
        .limit(1);

      const values = {
        organizationId,
        stayProfileId: profileId,
        code: 'base',
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        currency: input.currency,
        baseNightlyMinor: BigInt(input.baseNightlyMinor),
        weekendNightlyMinor: input.weekendNightlyMinor
          ? BigInt(input.weekendNightlyMinor)
          : null,
        dayUseMinor: input.dayUseMinor ? BigInt(input.dayUseMinor) : null,
        overnightOnlyMinor: input.overnightOnlyMinor
          ? BigInt(input.overnightOnlyMinor)
          : null,
        refundable: input.refundable,
        enabled: true,
        priority: 100,
        updatedAt: new Date(),
      };

      if (existing) {
        const [updated] = await transaction
          .update(stayRatePlans)
          .set(values)
          .where(eq(stayRatePlans.id, existing.id))
          .returning();
        return updated;
      }

      const [created] = await transaction.insert(stayRatePlans).values(values).returning();
      return created;
    });
  }

  async upsertListing(claims: SessionClaims, input: UpsertStayPublicListingInput) {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      await this.assertProperty(transaction, organizationId, input.propertyId);

      const [unitType] = await transaction
        .select({ id: stayUnitTypes.id })
        .from(stayUnitTypes)
        .where(
          and(
            eq(stayUnitTypes.id, input.unitTypeId),
            eq(stayUnitTypes.organizationId, organizationId),
            eq(stayUnitTypes.propertyId, input.propertyId),
          ),
        )
        .limit(1);
      if (!unitType) throw new NotFoundException('Stay unit type not found');

      const [existing] = await transaction
        .select({ id: stayPublicListings.id, slug: stayPublicListings.slug })
        .from(stayPublicListings)
        .where(
          and(
            eq(stayPublicListings.organizationId, organizationId),
            eq(stayPublicListings.propertyId, input.propertyId),
            eq(stayPublicListings.unitTypeId, input.unitTypeId),
          ),
        )
        .limit(1);

      const values = {
        organizationId,
        propertyId: input.propertyId,
        unitTypeId: input.unitTypeId,
        slug: input.slug,
        titleAr: input.titleAr,
        titleEn: input.titleEn,
        summaryAr: input.summaryAr ?? null,
        summaryEn: input.summaryEn ?? null,
        enabled: false,
        updatedAt: new Date(),
      };

      if (existing) {
        const [updated] = await transaction
          .update(stayPublicListings)
          .set({
            titleAr: values.titleAr,
            titleEn: values.titleEn,
            summaryAr: values.summaryAr,
            summaryEn: values.summaryEn,
            slug: existing.slug === input.slug ? existing.slug : input.slug,
            updatedAt: values.updatedAt,
          })
          .where(eq(stayPublicListings.id, existing.id))
          .returning();
        return updated;
      }

      const [created] = await transaction.insert(stayPublicListings).values(values).returning();
      return created;
    });
  }

  async publishProfile(claims: SessionClaims, profileId: string) {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    const result = await this.database.withinTenant(claims, async (transaction) => {
      const [profile] = await transaction
        .select({
          id: stayProfiles.id,
          unitId: stayProfiles.unitId,
          unitTypeId: stayProfiles.unitTypeId,
          publishStatus: stayProfiles.publishStatus,
        })
        .from(stayProfiles)
        .where(
          and(eq(stayProfiles.id, profileId), eq(stayProfiles.organizationId, organizationId)),
        )
        .limit(1);
      if (!profile) throw new NotFoundException('Stay profile not found');

      const [ratePlan] = await transaction
        .select({ id: stayRatePlans.id })
        .from(stayRatePlans)
        .where(
          and(
            eq(stayRatePlans.organizationId, organizationId),
            eq(stayRatePlans.stayProfileId, profileId),
            eq(stayRatePlans.enabled, true),
          ),
        )
        .limit(1);
      if (!ratePlan) {
        throw new ConflictException('Add a nightly rate before publishing');
      }

      const [unit] = await transaction
        .select({ propertyId: units.propertyId })
        .from(units)
        .where(and(eq(units.id, profile.unitId), eq(units.organizationId, organizationId)))
        .limit(1);
      if (!unit) throw new NotFoundException('Unit not found');

      const [listing] = await transaction
        .select({ id: stayPublicListings.id })
        .from(stayPublicListings)
        .where(
          and(
            eq(stayPublicListings.organizationId, organizationId),
            eq(stayPublicListings.propertyId, unit.propertyId),
            eq(stayPublicListings.unitTypeId, profile.unitTypeId),
          ),
        )
        .limit(1);
      if (!listing) {
        throw new ConflictException('Add public listing content before publishing');
      }

      const now = new Date();

      await transaction
        .update(stayProfiles)
        .set({
          enabled: true,
          publishStatus: 'published',
          updatedAt: now,
        })
        .where(eq(stayProfiles.id, profileId));

      await transaction
        .update(stayPublicListings)
        .set({
          enabled: true,
          publishedAt: now,
          updatedAt: now,
        })
        .where(eq(stayPublicListings.id, listing.id));

      await transaction.insert(outboxEvents).values({
        organizationId,
        topic: 'stay.inventory.changed',
        aggregateType: 'stay_profile',
        aggregateId: profileId,
        payload: { unitId: profile.unitId, reason: 'published' },
      });

      return { id: profileId, unitId: profile.unitId, publishStatus: 'published' as const };
    });

    await this.inventory.rebuildInventoryDays(organizationId, result.unitId);
    return result;
  }

  suggestSlug(propertyNameEn: string, unitCode: string): string {
    const base = slugify(`${propertyNameEn}-${unitCode}`);
    return base || `stay-${unitCode.toLowerCase()}`;
  }

  private async assertProperty(
    transaction: DatabaseTransaction,
    organizationId: string,
    propertyId: string,
  ) {
    const [property] = await transaction
      .select({
        id: properties.id,
        defaultCurrency: properties.defaultCurrency,
      })
      .from(properties)
      .where(
        and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)),
      )
      .limit(1);
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }
}
