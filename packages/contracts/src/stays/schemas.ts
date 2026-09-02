import { z } from 'zod';
import { currencyCodeSchema, moneySchema } from '../money.js';
import { localeSchema, uuidSchema } from '../schemas.js';
import { stayPoliciesJsonSchema } from './policies-schema.js';

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

export const stayBookingTypeSchema = z.enum(['overnight_stay', 'day_use', 'overnight_only']);

export const createStayQuoteSchema = z
  .object({
    checkInOn: z.iso.date(),
    checkOutOn: z.iso.date(),
    adults: z.coerce.number().int().min(1).max(50).default(1),
    children: z.coerce.number().int().min(0).max(50).default(0),
    /** overnight_stay = إقامة مع مبيت, day_use = بدون مبيت, overnight_only = مبيت فقط */
    stayType: stayBookingTypeSchema.default('overnight_stay'),
    /** Required when multiple published units share one listing slug. */
    unitId: uuidSchema.optional(),
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
    guestEmail: z.string().trim().email().max(320).optional(),
    guestPhone: z.string().trim().min(5).max(40).optional(),
  })
  .strict();

export const stayAvailabilityQuerySchema = z.object({
  checkInOn: z.iso.date(),
  checkOutOn: z.iso.date(),
  adults: z.coerce.number().int().min(1).max(50).default(1),
  children: z.coerce.number().int().min(0).max(50).default(0),
  unitId: uuidSchema.optional(),
});

export const stayDayAvailabilityStatusSchema = z.enum([
  'available',
  'blocked',
  'booked',
  'hold',
  'maintenance',
  'lease',
  'unavailable',
]);

export const stayInventoryCalendarQuerySchema = z
  .object({
    fromOn: z.iso.date(),
    toOn: z.iso.date(),
    unitId: uuidSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.toOn <= value.fromOn) {
      ctx.addIssue({
        code: 'custom',
        message: 'toOn must be after fromOn',
        path: ['toOn'],
      });
      return;
    }
    const start = new Date(`${value.fromOn}T00:00:00.000Z`);
    const end = new Date(`${value.toOn}T00:00:00.000Z`);
    const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    if (spanDays > 93) {
      ctx.addIssue({
        code: 'custom',
        message: 'Date range must not exceed 93 days',
        path: ['toOn'],
      });
    }
  });

export const stayInventoryDaySchema = z.object({
  stayDate: z.iso.date(),
  availabilityStatus: stayDayAvailabilityStatusSchema,
  effectiveRateMinor: z.string().regex(/^\d+$/).nullable().optional(),
  currency: currencyCodeSchema.nullable().optional(),
  publicNote: z.string().trim().max(280).nullable().optional(),
});

export const upsertStayInventoryDaySchema = z
  .object({
    stayDate: z.iso.date(),
    /** Major units string e.g. "20" or "25.500" — converted by API with profile currency. */
    rateMajor: z.string().trim().max(24).optional().nullable(),
    /** Clear custom rate and revert to base plan rate. */
    clearManualRate: z.boolean().optional(),
    publicNote: z.string().trim().max(280).optional().nullable(),
    availabilityStatus: z.enum(['available', 'blocked']).optional(),
  })
  .strict();

export type UpsertStayInventoryDayInput = z.infer<typeof upsertStayInventoryDaySchema>;

export const stayInventoryLockSpanSchema = z.object({
  kind: z.string().min(1).max(24),
  checkInOn: z.iso.date(),
  checkOutOn: z.iso.date(),
  bookingReference: z.string().max(32).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

export const stayInventoryCalendarResponseSchema = z.object({
  unitId: uuidSchema,
  fromOn: z.iso.date(),
  toOn: z.iso.date(),
  currency: currencyCodeSchema.nullable().optional(),
  days: z.array(stayInventoryDaySchema),
  locks: z.array(stayInventoryLockSpanSchema).optional(),
});

/** Public search card — safe for marketing surfaces. One row per published unit. */
export const staySearchListingSchema = z.object({
  slug: z.string().min(1).max(180),
  titleAr: z.string().min(1).max(200),
  titleEn: z.string().min(1).max(200),
  destination: z.string().max(200).nullable().optional(),
  nightlyMinor: z.string().regex(/^\d+$/).nullable().optional(),
  currency: currencyCodeSchema.nullable().optional(),
  coverImageUrl: z.string().nullable().optional(),
  maxGuests: z.number().int().min(1).max(100).nullable().optional(),
  unitId: uuidSchema.optional(),
  unitNameAr: z.string().max(200).optional(),
  unitNameEn: z.string().max(200).optional(),
  unitCode: z.string().max(64).nullable().optional(),
  propertyNameAr: z.string().max(200).optional(),
  propertyNameEn: z.string().max(200).optional(),
  bedrooms: z.number().int().nullable().optional(),
  bathrooms: z.number().int().nullable().optional(),
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
  wilayat: z.string().max(200).nullable().optional(),
  city: z.string().max(200).nullable().optional(),
  nightlyMinor: z.string().regex(/^\d+$/).nullable().optional(),
  dayUseMinor: z.string().regex(/^\d+$/).nullable().optional(),
  overnightOnlyMinor: z.string().regex(/^\d+$/).nullable().optional(),
  currency: currencyCodeSchema.nullable().optional(),
  maxGuests: z.number().int().min(1).max(100).nullable().optional(),
  unitId: uuidSchema.optional(),
  propertyId: uuidSchema.optional(),
  propertyNameAr: z.string().optional(),
  propertyNameEn: z.string().optional(),
  bedrooms: z.number().int().nullable().optional(),
  bathrooms: z.number().int().nullable().optional(),
  areaSquareMeters: z.number().nullable().optional(),
  checkInFrom: z.string().nullable().optional(),
  checkOutUntil: z.string().nullable().optional(),
  dayUseCheckOutUntil: z.string().nullable().optional(),
  overnightCheckOutUntil: z.string().nullable().optional(),
  dayUseMaxGuests: z.number().int().min(1).max(200).nullable().optional(),
  overnightMaxGuests: z.number().int().min(1).max(200).nullable().optional(),
  depositMinor: z.string().regex(/^\d+$/).nullable().optional(),
  policiesAr: z.string().nullable().optional(),
  policiesEn: z.string().nullable().optional(),
  policiesJson: stayPoliciesJsonSchema.optional(),
  instructionsAr: z.string().nullable().optional(),
  instructionsEn: z.string().nullable().optional(),
  coverImageUrl: z.string().nullable().optional(),
  imageUrls: z.array(z.string()).optional(),
  /** Smart score /10 blending guest reviews + occupancy (optional on detail). */
  smartScoreTen: z.number().nullable().optional(),
  guestScoreTen: z.number().nullable().optional(),
  occupancyPercent: z.number().nullable().optional(),
  stayReviewCount: z.number().int().nullable().optional(),
});

export type StayProfile = z.infer<typeof stayProfileSchema>;
export type StayQuote = z.infer<typeof stayQuoteSchema>;
export type StayHold = z.infer<typeof stayHoldSchema>;
export type StayBookingPublic = z.infer<typeof stayBookingPublicSchema>;
export type StaySearchQuery = z.infer<typeof staySearchQuerySchema>;
export type StaySearchListing = z.infer<typeof staySearchListingSchema>;
export type StaySearchResponse = z.infer<typeof staySearchResponseSchema>;
export type StayPublicDetail = z.infer<typeof stayPublicDetailSchema>;
export type StayDayAvailabilityStatus = z.infer<typeof stayDayAvailabilityStatusSchema>;
export type StayInventoryCalendarQuery = z.infer<typeof stayInventoryCalendarQuerySchema>;
export type StayInventoryDay = z.infer<typeof stayInventoryDaySchema>;
export type StayInventoryLockSpan = z.infer<typeof stayInventoryLockSpanSchema>;
export type StayInventoryCalendarResponse = z.infer<typeof stayInventoryCalendarResponseSchema>;
export const stayGuestBookingLookupSchema = z
  .object({
    referenceCode: z
      .string()
      .trim()
      .min(4)
      .max(32)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

export const stayGuestBookingClaimSchema = stayGuestBookingLookupSchema;

export const stayPerformanceQuerySchema = z
  .object({
    fromOn: z.iso.date(),
    toOn: z.iso.date(),
    propertyId: uuidSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.toOn <= value.fromOn) {
      ctx.addIssue({
        code: 'custom',
        message: 'toOn must be after fromOn',
        path: ['toOn'],
      });
    }
  });

export const stayPerformanceMetricsSchema = z.object({
  fromOn: z.iso.date(),
  toOn: z.iso.date(),
  propertyId: uuidSchema.nullable().optional(),
  currency: currencyCodeSchema.nullable(),
  availableRoomNights: z.number().int().min(0),
  occupiedRoomNights: z.number().int().min(0),
  roomRevenueMinor: z.string().regex(/^\d+$/),
  occupancyRatio: z.string().nullable(),
  occupancyPercent: z.string().nullable(),
  adrMinor: z.string().regex(/^\d+$/).nullable(),
  revparMinor: z.string().regex(/^\d+$/).nullable(),
  bookingCount: z.number().int().min(0),
});

export const stayOpsBookingsQuerySchema = z.object({
  status: stayBookingStatusSchema.optional(),
  propertyId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateStayQuoteInput = z.infer<typeof createStayQuoteSchema>;
export type CreateStayHoldInput = z.infer<typeof createStayHoldSchema>;
export type CreateStayBookingInput = z.infer<typeof createStayBookingSchema>;
export type StayAvailabilityQuery = z.infer<typeof stayAvailabilityQuerySchema>;
export type StayGuestBookingLookup = z.infer<typeof stayGuestBookingLookupSchema>;
export type StayGuestBookingClaim = z.infer<typeof stayGuestBookingClaimSchema>;
export type StayPerformanceQuery = z.infer<typeof stayPerformanceQuerySchema>;
export type StayPerformanceMetricsDto = z.infer<typeof stayPerformanceMetricsSchema>;
export type StayOpsBookingsQuery = z.infer<typeof stayOpsBookingsQuerySchema>;

export const createStayPaymentSessionSchema = z
  .object({
    paymentIntentId: uuidSchema,
    locale: localeSchema.default('ar'),
    returnPath: z
      .string()
      .regex(/^\/(ar|en)(\/[A-Za-z0-9._~-]{1,64}){1,6}(\?[A-Za-z0-9._~=&%-]{0,200})?$/),
  })
  .strict();

export type CreateStayPaymentSessionInput = z.infer<typeof createStayPaymentSessionSchema>;
