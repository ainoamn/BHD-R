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
  showOwnerNameOnListing: z.boolean().default(false).optional(),
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

export const listingLabelModeSchema = z.enum(['title', 'number', 'both']);
export const propertyCategorySchema = z.enum([
  'apartment',
  'villa',
  'house',
  'duplex',
  'townhouse',
  'penthouse',
  'studio',
  'chalet',
  'palace',
  'building',
  'hotel',
  'farm',
  'office',
  'shop',
  'showroom',
  'warehouse',
  'labor_camp',
  'land',
  'other',
]);

export const createPropertyObjectSchema = z.object({
  organizationId: uuidSchema,
  ownerPartyId: uuidSchema,
  kind: z.enum(['single_unit', 'multi_unit']),
  category: propertyCategorySchema,
  nameAr: z.string().trim().max(160).default(''),
  nameEn: z.string().trim().max(160).default(''),
  /** Owner-facing property number (not the system BHD serial). */
  displayNumber: z.string().trim().max(80).optional(),
  /** What the public listing should show as the property label. */
  listingLabelMode: listingLabelModeSchema.default('title'),
  descriptionAr: z.string().trim().max(5_000).optional(),
  descriptionEn: z.string().trim().max(5_000).optional(),
  address: addressSchema,
  defaultCurrency: currencyCodeSchema.default('OMR'),
  profile: propertyProfileSchema.optional(),
  amenities: z.array(propertyAmenitySchema).max(100).default([]),
  meters: z.array(utilityMeterSchema).max(500).default([]),
  documents: z.array(propertyDocumentSchema).max(100).default([]),
});

export function resolveStoredPropertyNames(input: {
  nameAr?: string | null;
  nameEn?: string | null;
  displayNumber?: string | null;
  listingLabelMode?: 'title' | 'number' | 'both' | string | null;
}): {
  nameAr: string;
  nameEn: string;
  displayNumber: string | null;
  listingLabelMode: 'title' | 'number' | 'both';
} {
  const listingLabelMode =
    input.listingLabelMode === 'number' || input.listingLabelMode === 'both'
      ? input.listingLabelMode
      : 'title';
  const displayNumber = (input.displayNumber ?? '').trim() || null;
  let nameAr = (input.nameAr ?? '').trim();
  let nameEn = (input.nameEn ?? '').trim();
  if (listingLabelMode === 'number') {
    const fallback = displayNumber || 'Property';
    if (nameAr.length < 2) nameAr = fallback;
    if (nameEn.length < 2) nameEn = fallback;
  }
  return { nameAr, nameEn, displayNumber, listingLabelMode };
}

/** Apply listing label mode to Arabic/English public property names. */
export function applyListingLabelMode(input: {
  nameAr?: string | null;
  nameEn?: string | null;
  displayNumber?: string | null;
  listingLabelMode?: 'title' | 'number' | 'both' | string | null;
}): { nameAr: string; nameEn: string } {
  const mode =
    input.listingLabelMode === 'number' || input.listingLabelMode === 'both'
      ? input.listingLabelMode
      : 'title';
  const number = (input.displayNumber ?? '').trim();
  const titleAr = (input.nameAr ?? '').trim();
  const titleEn = (input.nameEn ?? '').trim();
  if (mode === 'number') {
    return { nameAr: number || titleAr, nameEn: number || titleEn };
  }
  if (mode === 'both') {
    return {
      nameAr: number && titleAr ? `${number} · ${titleAr}` : number || titleAr,
      nameEn: number && titleEn ? `${number} · ${titleEn}` : number || titleEn,
    };
  }
  return { nameAr: titleAr || number, nameEn: titleEn || number };
}

export function refinePropertyListingLabel(
  value: {
    nameAr: string;
    nameEn: string;
    displayNumber?: string | undefined;
    listingLabelMode?: 'title' | 'number' | 'both' | undefined;
  },
  ctx: z.RefinementCtx,
) {
  const mode = value.listingLabelMode ?? 'title';
  const number = (value.displayNumber ?? '').trim();
  const nameAr = value.nameAr.trim();
  const nameEn = value.nameEn.trim();
  if (mode === 'title' || mode === 'both') {
    if (nameAr.length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['nameAr'],
        message: 'Property title (Arabic) is required',
      });
    }
    if (nameEn.length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['nameEn'],
        message: 'Property title (English) is required',
      });
    }
  }
  if (mode === 'number' || mode === 'both') {
    if (number.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['displayNumber'],
        message: 'Property number is required',
      });
    }
  }
}

export const createPropertySchema = createPropertyObjectSchema.superRefine(refinePropertyListingLabel);

export const createUnitSchema = z.object({
  propertyId: uuidSchema,
  code: z.string().trim().min(1).max(50),
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  floor: z.string().trim().max(30).optional(),
  bedrooms: z.number().int().min(0).max(50).default(0),
  bathrooms: z.number().int().min(0).max(50).default(0),
  majlis: z.number().int().min(0).max(50).default(0),
  halls: z.number().int().min(0).max(50).default(0),
  kitchens: z.number().int().min(0).max(50).default(0),
  hasPool: z.boolean().default(false),
  areaSquareMeters: z
    .string()
    .regex(/^\d+(\.\d{1,3})?$/)
    .optional(),
  listingPurpose: z.enum(['rent', 'sale', 'both']).default('rent'),
  /** sale | monthly | yearly | daily — CSV persisted on units.offering_modes */
  offeringModes: z
    .array(z.enum(['sale', 'monthly', 'yearly', 'daily']))
    .min(1)
    .max(4)
    .optional(),
  rent: moneySchema,
  salePrice: moneySchema.optional(),
  /** Rent booking deposit; also used for purchase when `saleDeposit` is not set. */
  deposit: moneySchema.optional(),
  /** Purchase booking deposit. `null` clears it; omitted keeps the stored value. */
  saleDeposit: moneySchema.nullable().optional(),
  publishWhenAvailable: z.boolean().default(false),
});

export const listingSearchSchema = z.object({
  locale: localeSchema.default('ar'),
  countryCode: countryCodeSchema.default('OM'),
  governorate: z.string().trim().max(120).optional(),
  category: propertyCategorySchema.optional(),
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
  propertyNameAr: z.string().max(260),
  propertyNameEn: z.string().max(260),
  displayNumber: z.string().max(80).nullable().optional(),
  listingLabelMode: listingLabelModeSchema.optional(),
  unitNameAr: z.string().max(120),
  unitNameEn: z.string().max(120),
  category: propertyCategorySchema,
  governorate: z.string().max(120),
  wilayat: z.string().max(120),
  bedrooms: z.number().int().nonnegative(),
  bathrooms: z.number().int().nonnegative(),
  areaSquareMeters: z.string().nullable(),
  listingPurpose: z.enum(['rent', 'sale', 'both']),
  rent: moneySchema,
  salePrice: moneySchema.nullable(),
  coverImageUrl: z.union([z.url(), z.string().regex(/^\/api\/(public|owner)\/media\//)]).nullable(),
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
    saleDeposit: moneySchema.nullable().optional(),
    images: z
      .array(
        z.object({
          id: uuidSchema,
          url: z.union([z.url(), z.string().regex(/^\/api\/(public|owner)\/media\//)]),
          altAr: z.string().max(200).optional(),
          altEn: z.string().max(200).optional(),
        }),
      )
      .max(40),
  });

export const publicPropertyDetailSchema = z.object({
  id: uuidSchema,
  nameAr: z.string().max(260),
  nameEn: z.string().max(260),
  displayNumber: z.string().max(80).nullable().optional(),
  listingLabelMode: listingLabelModeSchema.optional(),
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
  /** OM: أيام السماح بعد الاستحقاق */
  graceDays: z.number().int().min(0).max(90).default(0),
  /** OM: مبلغ السماح/الغرامة المرتبطة */
  graceAmount: moneySchema.optional(),
  /** OM: تاريخ تسليم الوحدة */
  handoverOn: z.iso.date().optional(),
  /** OM: مبالغ أخرى (تأمين إضافي، رسوم…) */
  otherCharges: z
    .array(
      z.object({
        labelAr: z.string().trim().min(1).max(160),
        labelEn: z.string().trim().min(1).max(160),
        amount: moneySchema,
      }),
    )
    .max(20)
    .default([]),
  /** OM: جدول الشيكات المرفقة بالعقد */
  cheques: z
    .array(
      z.object({
        bankName: z.string().trim().min(2).max(160),
        chequeNumber: z.string().trim().min(1).max(80),
        amount: moneySchema,
        dueOn: z.iso.date(),
      }),
    )
    .max(48)
    .default([]),
  /**
   * OM accounting approval presets:
   * accountant | accountant→finance | accountant→finance→admin
   */
  approvalChain: z
    .enum(['accountant', 'accountant_finance', 'accountant_finance_admin'])
    .default('accountant'),
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
