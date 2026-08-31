import { z } from 'zod';
import { currencyCodeSchema, moneySchema } from '../money.js';
import { localeSchema, uuidSchema } from '../schemas.js';

export const stayPublishStatusSchema = z.enum(['draft', 'ready', 'published', 'unpublished']);
export const stayBookingStatusSchema = z.enum([
  'request_pending',
  'payment_pending',
  'confirmed',
  'pre_arrival',
  'checked_in',
  'checked_out',
  'closed',
  'cancelled',
  'expired',
  'payment_failed',
  'no_show',
]);
export const stayHoldStatusSchema = z.enum(['active', 'converted', 'expired', 'cancelled']);
export const stayBookingModeSchema = z.enum(['instant', 'request']);

export const stayProfileSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  unitId: uuidSchema,
  unitTypeId: uuidSchema,
  enabled: z.boolean(),
  publishStatus: stayPublishStatusSchema,
  instantBook: z.boolean(),
  timezone: z.string().min(1).max(64),
  currency: currencyCodeSchema,
  minorUnit: z.number().int().min(0).max(6),
  maxAdults: z.number().int().min(0).max(50),
  maxChildren: z.number().int().min(0).max(50),
  maxGuests: z.number().int().min(1).max(100),
  minNights: z.number().int().min(1).max(365),
  maxNights: z.number().int().min(1).max(365),
  leadTimeHours: z.number().int().min(0).max(720),
  advanceBookingDays: z.number().int().min(1).max(730),
  checkInFrom: z.string().max(8).nullable().optional(),
  checkInUntil: z.string().max(8).nullable().optional(),
  checkOutUntil: z.string().max(8).nullable().optional(),
  cancellationPolicyId: uuidSchema.nullable().optional(),
  houseRulesId: uuidSchema.nullable().optional(),
});

export const stayQuoteSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  stayProfileId: uuidSchema,
  unitId: uuidSchema,
  checkInOn: z.iso.date(),
  checkOutOn: z.iso.date(),
  nights: z.number().int().min(1),
  adults: z.number().int().min(1).max(50),
  children: z.number().int().min(0).max(50),
  currency: currencyCodeSchema,
  minorUnit: z.number().int().min(0).max(6),
  subtotalMinor: z.string().regex(/^\d+$/),
  feesMinor: z.string().regex(/^\d+$/),
  taxMinor: z.string().regex(/^\d+$/),
  totalMinor: z.string().regex(/^\d+$/),
  total: moneySchema.optional(),
  expiresAt: z.iso.datetime(),
  payloadHash: z.string().min(8).max(128),
});

export const stayHoldSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  quoteId: uuidSchema,
  inventoryLockId: uuidSchema,
  status: stayHoldStatusSchema,
  expiresAt: z.iso.datetime(),
});

/** Public-safe booking projection — no encrypted PII or internal snapshots. */
export const stayBookingPublicSchema = z.object({
  id: uuidSchema,
  referenceCode: z.string().min(4).max(32),
  organizationId: uuidSchema,
  propertyId: uuidSchema,
  unitTypeId: uuidSchema,
  checkInOn: z.iso.date(),
  checkOutOn: z.iso.date(),
  timezone: z.string().min(1).max(64),
  status: stayBookingStatusSchema,
  bookingMode: stayBookingModeSchema,
  currency: currencyCodeSchema,
  totalMinor: z.string().regex(/^\d+$/),
  nights: z.number().int().min(1).optional(),
});

export const staySearchQuerySchema = z.object({
  locale: localeSchema.default('ar'),
  countryCode: z.string().regex(/^[A-Z]{2}$/).default('OM'),
  governorate: z.string().trim().max(120).optional(),
  wilayat: z.string().trim().max(120).optional(),
  checkInOn: z.iso.date().optional(),
  checkOutOn: z.iso.date().optional(),
  adults: z.coerce.number().int().min(1).max(50).default(1),
  children: z.coerce.number().int().min(0).max(50).default(0),
  currency: currencyCodeSchema.optional(),
  minNightlyMinor: z.string().regex(/^\d+$/).optional(),
  maxNightlyMinor: z.string().regex(/^\d+$/).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const createStayQuoteSchema = z
  .object({
    checkInOn: z.iso.date(),
    checkOutOn: z.iso.date(),
    adults: z.coerce.number().int().min(1).max(50).default(1),
    children: z.coerce.number().int().min(0).max(50).default(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.checkOutOn <= value.checkInOn) {
      ctx.addIssue({
        code: 'custom',
        message: 'checkOutOn must be after checkInOn',
        path: ['checkOutOn'],
      });
    }
  });

export const createStayHoldSchema = z
  .object({
    quoteId: uuidSchema,
  })
  .strict();

export const createStayBookingSchema = z
  .object({
    holdId: uuidSchema,
    guestDisplayName: z.string().trim().min(2).max(160).optional(),
  })
  .strict();

export const stayAvailabilityQuerySchema = z.object({
  checkInOn: z.iso.date(),
  checkOutOn: z.iso.date(),
  adults: z.coerce.number().int().min(1).max(50).default(1),
  children: z.coerce.number().int().min(0).max(50).default(0),
});

/** Public search card — safe for marketing surfaces. */
export const staySearchListingSchema = z.object({
  slug: z.string().min(1).max(180),
  titleAr: z.string().min(1).max(200),
  titleEn: z.string().min(1).max(200),
  destination: z.string().max(200).nullable().optional(),
  nightlyMinor: z.string().regex(/^\d+$/).nullable().optional(),
  currency: currencyCodeSchema.nullable().optional(),
  coverImageUrl: z.string().url().nullable().optional(),
  maxGuests: z.number().int().min(1).max(100).nullable().optional(),
  unitId: uuidSchema.optional(),
});

export const staySearchResponseSchema = z.object({
  items: z.array(staySearchListingSchema),
  nextCursor: z.string().nullable(),
  cached: z.boolean().optional(),
});

export const stayPublicDetailSchema = z.object({
  slug: z.string().min(1).max(180),
  titleAr: z.string().min(1).max(200),
  titleEn: z.string().min(1).max(200),
  descriptionAr: z.string().nullable().optional(),
  descriptionEn: z.string().nullable().optional(),
  destination: z.string().max(200).nullable().optional(),
  nightlyMinor: z.string().regex(/^\d+$/).nullable().optional(),
  currency: currencyCodeSchema.nullable().optional(),
  maxGuests: z.number().int().min(1).max(100).nullable().optional(),
  unitId: uuidSchema.optional(),
});

export type StayProfile = z.infer<typeof stayProfileSchema>;
export type StayQuote = z.infer<typeof stayQuoteSchema>;
export type StayHold = z.infer<typeof stayHoldSchema>;
export type StayBookingPublic = z.infer<typeof stayBookingPublicSchema>;
export type StaySearchQuery = z.infer<typeof staySearchQuerySchema>;
export type StaySearchListing = z.infer<typeof staySearchListingSchema>;
export type StaySearchResponse = z.infer<typeof staySearchResponseSchema>;
export type StayPublicDetail = z.infer<typeof stayPublicDetailSchema>;
export type CreateStayQuoteInput = z.infer<typeof createStayQuoteSchema>;
export type CreateStayHoldInput = z.infer<typeof createStayHoldSchema>;
export type CreateStayBookingInput = z.infer<typeof createStayBookingSchema>;
export type StayAvailabilityQuery = z.infer<typeof stayAvailabilityQuerySchema>;
