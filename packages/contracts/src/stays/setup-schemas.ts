import { z } from 'zod';
import { currencyCodeSchema } from '../money.js';
import { uuidSchema } from '../schemas.js';
import { stayPublishStatusSchema } from './schemas.js';

export const staySetupContextQuerySchema = z
  .object({
    propertyId: uuidSchema,
  })
  .strict();

export const staySetupUnitRowSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  bedrooms: z.number().int(),
  bathrooms: z.number().int(),
  profileId: uuidSchema.nullable(),
  publishStatus: stayPublishStatusSchema.nullable(),
});

export const staySetupUnitTypeRowSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  maxGuests: z.number().int(),
});

export const staySetupListingRowSchema = z.object({
  id: uuidSchema,
  unitTypeId: uuidSchema,
  slug: z.string(),
  titleAr: z.string(),
  titleEn: z.string(),
  enabled: z.boolean(),
  publishedAt: z.string().datetime().nullable(),
});

export const staySetupContextSchema = z.object({
  propertyId: uuidSchema,
  propertyNameAr: z.string(),
  propertyNameEn: z.string(),
  defaultCurrency: z.string(),
  units: z.array(staySetupUnitRowSchema),
  unitTypes: z.array(staySetupUnitTypeRowSchema),
  listings: z.array(staySetupListingRowSchema),
});

export const createStayUnitTypeSchema = z
  .object({
    propertyId: uuidSchema,
    code: z.string().trim().min(1).max(64),
    nameAr: z.string().trim().min(1).max(160),
    nameEn: z.string().trim().min(1).max(160),
    maxAdults: z.coerce.number().int().min(1).max(50).default(2),
    maxChildren: z.coerce.number().int().min(0).max(50).default(0),
    maxGuests: z.coerce.number().int().min(1).max(100).default(2),
    bedrooms: z.coerce.number().int().min(0).max(50).default(1),
    beds: z.coerce.number().int().min(1).max(50).default(1),
    bathrooms: z.coerce.number().int().min(0).max(50).default(1),
  })
  .strict();

export const createStayProfilesSchema = z
  .object({
    propertyId: uuidSchema,
    unitTypeId: uuidSchema,
    unitIds: z.array(uuidSchema).min(1).max(50),
    currency: currencyCodeSchema.optional(),
    maxAdults: z.coerce.number().int().min(1).max(50).optional(),
    maxChildren: z.coerce.number().int().min(0).max(50).optional(),
    maxGuests: z.coerce.number().int().min(1).max(100).optional(),
    minNights: z.coerce.number().int().min(1).max(365).default(1),
    maxNights: z.coerce.number().int().min(1).max(365).default(30),
    instantBook: z.boolean().default(false),
    checkInFrom: z.string().max(8).nullable().optional(),
    checkInUntil: z.string().max(8).nullable().optional(),
    checkOutUntil: z.string().max(8).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.maxNights < value.minNights) {
      ctx.addIssue({
        code: 'custom',
        message: 'maxNights must be >= minNights',
        path: ['maxNights'],
      });
    }
  });

export const updateStayProfileSchema = z
  .object({
    maxAdults: z.coerce.number().int().min(1).max(50).optional(),
    maxChildren: z.coerce.number().int().min(0).max(50).optional(),
    maxGuests: z.coerce.number().int().min(1).max(100).optional(),
    minNights: z.coerce.number().int().min(1).max(365).optional(),
    maxNights: z.coerce.number().int().min(1).max(365).optional(),
    instantBook: z.boolean().optional(),
    checkInFrom: z.string().max(8).nullable().optional(),
    checkInUntil: z.string().max(8).nullable().optional(),
    checkOutUntil: z.string().max(8).nullable().optional(),
  })
  .strict();

export const upsertStayRatePlanSchema = z
  .object({
    baseNightlyMinor: z.string().regex(/^\d+$/),
    weekendNightlyMinor: z.string().regex(/^\d+$/).optional(),
    currency: currencyCodeSchema,
    nameAr: z.string().trim().min(1).max(160).default('السعر الأساسي'),
    nameEn: z.string().trim().min(1).max(160).default('Base rate'),
    refundable: z.boolean().default(true),
  })
  .strict();

export const upsertStayPublicListingSchema = z
  .object({
    propertyId: uuidSchema,
    unitTypeId: uuidSchema,
    slug: z
      .string()
      .trim()
      .min(3)
      .max(180)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    titleAr: z.string().trim().min(2).max(200),
    titleEn: z.string().trim().min(2).max(200),
    summaryAr: z.string().trim().max(2000).optional(),
    summaryEn: z.string().trim().max(2000).optional(),
  })
  .strict();

export type StaySetupContextQuery = z.infer<typeof staySetupContextQuerySchema>;
export type StaySetupContext = z.infer<typeof staySetupContextSchema>;
export type CreateStayUnitTypeInput = z.infer<typeof createStayUnitTypeSchema>;
export type CreateStayProfilesInput = z.infer<typeof createStayProfilesSchema>;
export type UpdateStayProfileInput = z.infer<typeof updateStayProfileSchema>;
export type UpsertStayRatePlanInput = z.infer<typeof upsertStayRatePlanSchema>;
export type UpsertStayPublicListingInput = z.infer<typeof upsertStayPublicListingSchema>;
