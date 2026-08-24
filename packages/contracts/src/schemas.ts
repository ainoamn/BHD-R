import { z } from 'zod';
import { currencyCodeSchema, moneySchema } from './money.js';

export const uuidSchema = z.uuid();
export const localeSchema = z.enum(['ar', 'en']);
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

export const addressSchema = z.object({
  countryCode: countryCodeSchema.default('OM'),
  governorate: z.string().trim().min(1).max(120),
  wilayat: z.string().trim().min(1).max(120),
  city: z.string().trim().min(1).max(120),
  area: z.string().trim().max(120).optional(),
  street: z.string().trim().max(160).optional(),
  buildingNumber: z.string().trim().max(50).optional(),
  postalCode: z.string().trim().max(24).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const propertyProfileSchema = z.object({
  deedNumber: z.string().trim().max(120).optional(),
  plotNumber: z.string().trim().max(120).optional(),
  municipalityNumber: z.string().trim().max(120).optional(),
  electricityAccountNumber: z.string().trim().max(120).optional(),
  waterAccountNumber: z.string().trim().max(120).optional(),
  landAreaSquareMeters: z
    .string()
    .regex(/^\d+(\.\d{1,3})?$/)
    .optional(),
  builtUpAreaSquareMeters: z
    .string()
    .regex(/^\d+(\.\d{1,3})?$/)
    .optional(),
  yearBuilt: z.number().int().min(1800).max(2200).optional(),
  floorsCount: z.number().int().min(0).max(300).optional(),
  parkingSpaces: z.number().int().min(0).max(10_000).optional(),
  furnishing: z.enum(['unfurnished', 'semi_furnished', 'furnished']).default('unfurnished'),
  managementStartedOn: z.iso.date().optional(),
  managementFee: moneySchema.optional(),
  notes: z.string().trim().max(5_000).optional(),
});

export const propertyAmenitySchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_-]+$/),
  labelAr: z.string().trim().max(120).optional(),
  labelEn: z.string().trim().max(120).optional(),
});

export const utilityMeterSchema = z.object({
  unitCode: z.string().trim().max(50).optional(),
  utilityType: z.enum(['electricity', 'water', 'gas', 'internet', 'cooling', 'other']),
  meterNumber: z.string().trim().min(1).max(120),
  provider: z.string().trim().max(160).optional(),
  accountNumber: z.string().trim().max(120).optional(),
});

export const propertyDocumentSchema = z.object({
  documentType: z.enum([
    'title_deed',
    'municipality',
    'insurance',
    'management_agreement',
    'noc',
    'floor_plan',
    'other',
  ]),
  documentNumber: z.string().trim().max(120).optional(),
  issuedOn: z.iso.date().optional(),
  expiresOn: z.iso.date().optional(),
  notes: z.string().trim().max(2_000).optional(),
});

export const createPropertySchema = z.object({
  organizationId: uuidSchema,
  ownerPartyId: uuidSchema,
  kind: z.enum(['single_unit', 'multi_unit']),
  category: z.enum([
    'apartment',
    'villa',
    'building',
    'office',
    'shop',
    'warehouse',
    'land',
    'other',
  ]),
  nameAr: z.string().trim().min(2).max(160),
  nameEn: z.string().trim().min(2).max(160),
  descriptionAr: z.string().trim().max(5_000).optional(),
  descriptionEn: z.string().trim().max(5_000).optional(),
  address: addressSchema,
  defaultCurrency: currencyCodeSchema.default('OMR'),
  profile: propertyProfileSchema.optional(),
  amenities: z.array(propertyAmenitySchema).max(100).default([]),
  meters: z.array(utilityMeterSchema).max(500).default([]),
  documents: z.array(propertyDocumentSchema).max(100).default([]),
});

export const createUnitSchema = z.object({
  propertyId: uuidSchema,
  code: z.string().trim().min(1).max(50),
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  floor: z.string().trim().max(30).optional(),
  bedrooms: z.number().int().min(0).max(50).default(0),
  bathrooms: z.number().int().min(0).max(50).default(0),
  areaSquareMeters: z
    .string()
    .regex(/^\d+(\.\d{1,3})?$/)
    .optional(),
  listingPurpose: z.enum(['rent', 'sale', 'both']).default('rent'),
  rent: moneySchema,
  salePrice: moneySchema.optional(),
  deposit: moneySchema.optional(),
  publishWhenAvailable: z.boolean().default(false),
});

export const listingSearchSchema = z.object({
  locale: localeSchema.default('ar'),
  countryCode: countryCodeSchema.default('OM'),
  governorate: z.string().trim().max(120).optional(),
  category: createPropertySchema.shape.category.optional(),
  bedrooms: z.coerce.number().int().min(0).optional(),
  currency: currencyCodeSchema.optional(),
  listingPurpose: z.enum(['rent', 'sale']).optional(),
  minRentMinor: z.coerce.bigint().nonnegative().optional(),
  maxRentMinor: z.coerce.bigint().nonnegative().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const publicListingSchema = z.object({
  id: uuidSchema,
  slug: z.string().min(1).max(180),
  propertyId: uuidSchema,
  unitId: uuidSchema,
  propertyNameAr: z.string().max(160),
  propertyNameEn: z.string().max(160),
  unitNameAr: z.string().max(120),
  unitNameEn: z.string().max(120),
  category: createPropertySchema.shape.category,
  governorate: z.string().max(120),
  wilayat: z.string().max(120),
  bedrooms: z.number().int().nonnegative(),
  bathrooms: z.number().int().nonnegative(),
  areaSquareMeters: z.string().nullable(),
  listingPurpose: z.enum(['rent', 'sale', 'both']),
  rent: moneySchema,
  salePrice: moneySchema.nullable(),
  coverImageUrl: z.url().nullable(),
  available: z.literal(true),
  publishedAt: z.iso.datetime(),
});

export const listingCollectionSchema = z.object({
  data: z.array(publicListingSchema),
  pagination: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }),
});

export const publicUnitDetailSchema = publicListingSchema
  .omit({ coverImageUrl: true, publishedAt: true })
  .extend({
    code: z.string().max(50),
    descriptionAr: z.string().nullable(),
    descriptionEn: z.string().nullable(),
    city: z.string().max(120),
    deposit: moneySchema.nullable(),
    images: z
      .array(
        z.object({
          id: uuidSchema,
          url: z.url(),
          altAr: z.string().max(200).optional(),
          altEn: z.string().max(200).optional(),
        }),
      )
      .max(40),
  });

export const publicPropertyDetailSchema = z.object({
  id: uuidSchema,
  nameAr: z.string().max(160),
  nameEn: z.string().max(160),
  descriptionAr: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  governorate: z.string().max(120),
  wilayat: z.string().max(120),
  units: z.array(publicListingSchema),
});

export const createHoldSchema = z.object({
  unitId: uuidSchema,
  prospectPartyId: uuidSchema.optional(),
  expiresAt: z.iso.datetime(),
  note: z.string().trim().max(1_000).optional(),
});

export const createLeaseSchema = z.object({
  unitId: uuidSchema,
  ownerPartyId: uuidSchema,
  tenantPartyId: uuidSchema,
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  rent: moneySchema,
  deposit: moneySchema.optional(),
  billingDay: z.number().int().min(1).max(28),
  templateVersionId: uuidSchema,
});

export const recordPaymentSchema = z.object({
  invoiceId: uuidSchema,
  amount: moneySchema,
  provider: z.string().trim().min(1).max(80),
  providerReference: z.string().trim().min(1).max(200),
  receivedAt: z.iso.datetime(),
  method: z.enum(['bank_transfer', 'card', 'cash', 'cheque', 'other']),
});

export const createMaintenanceTicketSchema = z.object({
  unitId: uuidSchema,
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(5_000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  category: z.enum(['plumbing', 'electricity', 'hvac', 'appliance', 'structural', 'other']),
});

export const paginationSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const signatureEvidenceSchema = z.object({
  signatureId: uuidSchema,
  contractId: uuidSchema,
  contractVersionId: uuidSchema,
  signerPartyId: uuidSchema,
  signerUserId: uuidSchema,
  signingRole: z.enum(['owner', 'tenant', 'witness', 'authorized_representative']),
  authenticationMethod: z.enum([
    'recent_sign_in',
    'oidc_reauthentication',
    'sms_otp',
    'email_otp',
    'totp',
  ]),
  sessionId: uuidSchema,
  consentTextVersion: z.string().min(1).max(80),
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  ipHash: z.string().regex(/^[a-f0-9]{64}$/),
  userAgentHash: z.string().regex(/^[a-f0-9]{64}$/),
  signedAt: z.iso.datetime(),
  challengeId: uuidSchema,
});

export const activationRequestSchema = z.object({
  userId: uuidSchema,
  username: z.string().trim().min(3).max(80),
  deliveryChannel: z.enum(['sms', 'email']),
  expiresAt: z.iso.datetime(),
});

export const publicInvoiceSchema = z.object({
  publicReference: z.string().min(12).max(160),
  status: z.enum(['issued', 'partially_paid', 'paid', 'overdue', 'void']),
  issuedOn: z.iso.date(),
  dueOn: z.iso.date(),
  total: moneySchema,
  outstanding: moneySchema,
  merchantName: z.string().max(160),
  paymentEnabled: z.boolean(),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type ListingSearchInput = z.infer<typeof listingSearchSchema>;
export type PublicListing = z.infer<typeof publicListingSchema>;
export type ListingCollection = z.infer<typeof listingCollectionSchema>;
export type PublicUnitDetail = z.infer<typeof publicUnitDetailSchema>;
export type PublicPropertyDetail = z.infer<typeof publicPropertyDetailSchema>;
export type CreateHoldInput = z.infer<typeof createHoldSchema>;
export type CreateLeaseInput = z.infer<typeof createLeaseSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type CreateMaintenanceTicketInput = z.infer<typeof createMaintenanceTicketSchema>;
export type SignatureEvidence = z.infer<typeof signatureEvidenceSchema>;
export type PublicInvoice = z.infer<typeof publicInvoiceSchema>;
