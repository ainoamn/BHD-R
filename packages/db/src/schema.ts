import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType: () => 'geography(Point,4326)',
});

const identityColumns = {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const organizationType = pgEnum('organization_type', ['individual', 'company', 'developer']);
export const partyType = pgEnum('party_type', ['person', 'company']);
export const propertyKind = pgEnum('property_kind', ['single_unit', 'multi_unit']);
export const propertyCategory = pgEnum('property_category', [
  'apartment',
  'villa',
  'building',
  'office',
  'shop',
  'warehouse',
  'land',
  'other',
]);
export const lifecycleStatus = pgEnum('lifecycle_status', [
  'draft',
  'active',
  'inactive',
  'archived',
]);
export const holdStatus = pgEnum('hold_status', ['active', 'expired', 'converted', 'cancelled']);
export const reservationStatus = pgEnum('reservation_status', [
  'pending',
  'confirmed',
  'cancelled',
  'converted',
  'expired',
]);
export const contractStatus = pgEnum('contract_status', [
  'draft',
  'sent',
  'partially_signed',
  'signed',
  'void',
  'terminated',
]);
export const leaseStatus = pgEnum('lease_status', ['draft', 'active', 'ended', 'terminated']);
export const invoiceStatus = pgEnum('invoice_status', [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'overdue',
  'void',
]);
export const paymentStatus = pgEnum('payment_status', [
  'pending',
  'succeeded',
  'failed',
  'refunded',
  'partially_refunded',
]);
export const maintenanceStatus = pgEnum('maintenance_status', [
  'open',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
  'cancelled',
]);
export const maintenancePriority = pgEnum('maintenance_priority', [
  'low',
  'normal',
  'high',
  'urgent',
]);
export const workflowStatus = pgEnum('workflow_status', [
  'draft',
  'pending',
  'approved',
  'in_progress',
  'on_hold',
  'completed',
  'rejected',
  'cancelled',
]);
export const viewingStatus = pgEnum('viewing_status', [
  'requested',
  'scheduled',
  'completed',
  'no_show',
  'cancelled',
  'converted',
]);
export const salesDealStatus = pgEnum('sales_deal_status', [
  'lead',
  'qualified',
  'viewing',
  'offer',
  'negotiation',
  'reserved',
  'contracting',
  'closed_won',
  'closed_lost',
  'cancelled',
]);
export const workOrderStatus = pgEnum('work_order_status', [
  'draft',
  'quoted',
  'awaiting_approval',
  'approved',
  'scheduled',
  'in_progress',
  'completed',
  'verified',
  'cancelled',
]);
export const legalCaseStatus = pgEnum('legal_case_status', [
  'assessment',
  'notice',
  'filed',
  'hearing',
  'judgment',
  'enforcement',
  'settled',
  'closed',
  'cancelled',
]);
export const ledgerAccountType = pgEnum('ledger_account_type', [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
]);
export const journalStatus = pgEnum('journal_status', ['draft', 'posted', 'reversed']);

export const countryPacks = pgTable('country_packs', {
  countryCode: varchar('country_code', { length: 2 }).primaryKey(),
  nameAr: varchar('name_ar', { length: 120 }).notNull(),
  nameEn: varchar('name_en', { length: 120 }).notNull(),
  defaultCurrency: varchar('default_currency', { length: 3 }).notNull(),
  addressSchema: jsonb('address_schema').notNull().default({}),
  legalSettings: jsonb('legal_settings').notNull().default({}),
  active: boolean('active').notNull().default(true),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const currencies = pgTable(
  'currencies',
  {
    code: varchar('code', { length: 3 }).primaryKey(),
    nameAr: varchar('name_ar', { length: 80 }).notNull(),
    nameEn: varchar('name_en', { length: 80 }).notNull(),
    symbolAr: varchar('symbol_ar', { length: 16 }).notNull(),
    symbolEn: varchar('symbol_en', { length: 16 }).notNull(),
    minorUnit: integer('minor_unit').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (table) => [check('currencies_minor_unit_check', sql`${table.minorUnit} between 0 and 6`)],
);

export const organizations = pgTable(
  'organizations',
  {
    ...identityColumns,
    type: organizationType('type').notNull(),
    slug: varchar('slug', { length: 80 }).notNull(),
    legalName: varchar('legal_name', { length: 200 }).notNull(),
    displayNameAr: varchar('display_name_ar', { length: 160 }).notNull(),
    displayNameEn: varchar('display_name_en', { length: 160 }).notNull(),
    countryCode: varchar('country_code', { length: 2 })
      .notNull()
      .default('OM')
      .references(() => countryPacks.countryCode),
    defaultCurrency: varchar('default_currency', { length: 3 })
      .notNull()
      .default('OMR')
      .references(() => currencies.code),
    status: lifecycleStatus('status').notNull().default('active'),
    planKey: varchar('plan_key', { length: 80 }).notNull().default('starter'),
  },
  (table) => [uniqueIndex('organizations_slug_unique').on(table.slug)],
);

export const parties = pgTable(
  'parties',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    type: partyType('type').notNull(),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    email: varchar('email', { length: 320 }),
    phone: varchar('phone', { length: 40 }),
    nationalIdEncrypted: text('national_id_encrypted'),
    registrationNumberEncrypted: text('registration_number_encrypted'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (table) => [
    index('parties_org_idx').on(table.organizationId),
    uniqueIndex('parties_org_email_unique').on(table.organizationId, table.email),
  ],
);

export const users = pgTable(
  'users',
  {
    ...identityColumns,
    identitySubject: varchar('identity_subject', { length: 200 }),
    username: varchar('username', { length: 100 }).notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    displayName: varchar('display_name', { length: 160 }).notNull(),
    credentialHash: text('credential_hash'),
    sessionVersion: integer('session_version').notNull().default(0),
    locale: varchar('locale', { length: 2 }).notNull().default('ar'),
    totpSecretEncrypted: text('totp_secret_encrypted'),
    totpConfirmedAt: timestamp('totp_confirmed_at', { withTimezone: true }),
    totpLastAcceptedCounter: bigint('totp_last_accepted_counter', { mode: 'number' }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('users_username_unique').on(table.username),
    uniqueIndex('users_email_unique').on(table.email),
    uniqueIndex('users_identity_subject_unique').on(table.identitySubject),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    partyId: uuid('party_id').references(() => parties.id),
    roleKey: varchar('role_key', { length: 80 }).notNull(),
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    status: lifecycleStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId, table.roleKey] }),
    index('memberships_user_idx').on(table.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    ...identityColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenIdHash: varchar('token_id_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ipHash: varchar('ip_hash', { length: 64 }),
    userAgentHash: varchar('user_agent_hash', { length: 64 }),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenIdHash),
    index('sessions_user_idx').on(table.userId),
  ],
);

export const credentialTokens = pgTable(
  'credential_tokens',
  {
    ...identityColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    purpose: varchar('purpose', { length: 32 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('credential_tokens_hash_unique').on(table.tokenHash),
    index('credential_tokens_user_idx').on(table.userId),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 120 }).notNull(),
    prefix: varchar('prefix', { length: 24 }).notNull(),
    secretDigest: varchar('secret_digest', { length: 128 }).notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('api_keys_org_idx').on(table.organizationId),
    uniqueIndex('api_keys_digest_unique').on(table.secretDigest),
  ],
);

export const addresses = pgTable(
  'addresses',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    countryCode: varchar('country_code', { length: 2 }).notNull().default('OM'),
    governorate: varchar('governorate', { length: 120 }).notNull(),
    wilayat: varchar('wilayat', { length: 120 }).notNull(),
    city: varchar('city', { length: 120 }).notNull(),
    area: varchar('area', { length: 120 }),
    street: varchar('street', { length: 160 }),
    buildingNumber: varchar('building_number', { length: 50 }),
    postalCode: varchar('postal_code', { length: 24 }),
    location: geographyPoint('location'),
  },
  (table) => [
    index('addresses_org_idx').on(table.organizationId),
    index('addresses_location_gist_idx').using('gist', table.location),
  ],
);

export const properties = pgTable(
  'properties',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    ownerPartyId: uuid('owner_party_id')
      .notNull()
      .references(() => parties.id),
    addressId: uuid('address_id')
      .notNull()
      .references(() => addresses.id),
    kind: propertyKind('kind').notNull(),
    category: propertyCategory('category').notNull(),
    nameAr: varchar('name_ar', { length: 160 }).notNull(),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    descriptionAr: text('description_ar'),
    descriptionEn: text('description_en'),
    defaultCurrency: varchar('default_currency', { length: 3 }).notNull(),
    status: lifecycleStatus('status').notNull().default('draft'),
  },
  (table) => [
    index('properties_org_idx').on(table.organizationId),
    index('properties_owner_idx').on(table.ownerPartyId),
  ],
);

export const units = pgTable(
  'units',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    code: varchar('code', { length: 50 }).notNull(),
    nameAr: varchar('name_ar', { length: 120 }).notNull(),
    nameEn: varchar('name_en', { length: 120 }).notNull(),
    floor: varchar('floor', { length: 30 }),
    bedrooms: integer('bedrooms').notNull().default(0),
    bathrooms: integer('bathrooms').notNull().default(0),
    areaSquareMeters: varchar('area_square_meters', { length: 32 }),
    rentMinor: bigint('rent_minor', { mode: 'bigint' }).notNull(),
    salePriceMinor: bigint('sale_price_minor', { mode: 'bigint' }),
    depositMinor: bigint('deposit_minor', { mode: 'bigint' }),
    currency: varchar('currency', { length: 3 }).notNull(),
    minorUnit: integer('minor_unit').notNull(),
    listingPurpose: varchar('listing_purpose', { length: 16 }).notNull().default('rent'),
    publishWhenAvailable: boolean('publish_when_available').notNull().default(false),
    status: lifecycleStatus('status').notNull().default('draft'),
  },
  (table) => [
    uniqueIndex('units_property_code_unique').on(table.propertyId, table.code),
    index('units_org_idx').on(table.organizationId),
    check('units_listing_purpose_check', sql`${table.listingPurpose} IN ('rent', 'sale', 'both')`),
    check(
      'units_sale_price_nonnegative',
      sql`${table.salePriceMinor} IS NULL OR ${table.salePriceMinor} >= 0`,
    ),
  ],
);

export const propertyProfiles = pgTable(
  'property_profiles',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    deedNumber: varchar('deed_number', { length: 120 }),
    plotNumber: varchar('plot_number', { length: 120 }),
    municipalityNumber: varchar('municipality_number', { length: 120 }),
    electricityAccountNumber: varchar('electricity_account_number', { length: 120 }),
    waterAccountNumber: varchar('water_account_number', { length: 120 }),
    landAreaSquareMeters: varchar('land_area_square_meters', { length: 32 }),
    builtUpAreaSquareMeters: varchar('built_up_area_square_meters', { length: 32 }),
    yearBuilt: integer('year_built'),
    floorsCount: integer('floors_count'),
    parkingSpaces: integer('parking_spaces'),
    furnishing: varchar('furnishing', { length: 24 }).notNull().default('unfurnished'),
    managementStartedOn: date('management_started_on'),
    managementFeeMinor: bigint('management_fee_minor', { mode: 'bigint' }),
    notes: text('notes'),
  },
  (table) => [
    uniqueIndex('property_profiles_property_unique').on(table.propertyId),
    index('property_profiles_org_idx').on(table.organizationId),
    check(
      'property_profiles_furnishing_check',
      sql`${table.furnishing} IN ('unfurnished', 'semi_furnished', 'furnished')`,
    ),
    check(
      'property_profiles_year_built_check',
      sql`${table.yearBuilt} IS NULL OR (${table.yearBuilt} >= 1800 AND ${table.yearBuilt} <= 2200)`,
    ),
    check(
      'property_profiles_management_fee_nonnegative',
      sql`${table.managementFeeMinor} IS NULL OR ${table.managementFeeMinor} >= 0`,
    ),
  ],
);

export const propertyAmenities = pgTable(
  'property_amenities',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    code: varchar('code', { length: 80 }).notNull(),
    labelAr: varchar('label_ar', { length: 120 }),
    labelEn: varchar('label_en', { length: 120 }),
  },
  (table) => [
    uniqueIndex('property_amenities_property_code_unique').on(table.propertyId, table.code),
    index('property_amenities_org_idx').on(table.organizationId),
  ],
);

export const propertyOwnershipInterests = pgTable(
  'property_ownership_interests',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id),
    role: varchar('role', { length: 32 }).notNull().default('owner'),
    shareBasisPoints: integer('share_basis_points').notNull().default(10000),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
  },
  (table) => [
    uniqueIndex('property_ownership_property_party_unique').on(table.propertyId, table.partyId),
    index('property_ownership_org_idx').on(table.organizationId),
    check(
      'property_ownership_share_check',
      sql`${table.shareBasisPoints} > 0 AND ${table.shareBasisPoints} <= 10000`,
    ),
    check(
      'property_ownership_role_check',
      sql`${table.role} IN ('owner', 'usufructuary', 'representative')`,
    ),
  ],
);

export const utilityMeters = pgTable(
  'utility_meters',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    unitId: uuid('unit_id').references(() => units.id),
    utilityType: varchar('utility_type', { length: 24 }).notNull(),
    meterNumber: varchar('meter_number', { length: 120 }).notNull(),
    provider: varchar('provider', { length: 160 }),
    accountNumber: varchar('account_number', { length: 120 }),
  },
  (table) => [
    uniqueIndex('utility_meters_property_number_unique').on(
      table.propertyId,
      table.utilityType,
      table.meterNumber,
    ),
    index('utility_meters_org_idx').on(table.organizationId),
    check(
      'utility_meters_type_check',
      sql`${table.utilityType} IN ('electricity', 'water', 'gas', 'internet', 'cooling', 'other')`,
    ),
  ],
);

export const listings = pgTable(
  'listings',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    slug: varchar('slug', { length: 180 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    seoTitleAr: varchar('seo_title_ar', { length: 180 }),
    seoTitleEn: varchar('seo_title_en', { length: 180 }),
    seoDescriptionAr: varchar('seo_description_ar', { length: 300 }),
    seoDescriptionEn: varchar('seo_description_en', { length: 300 }),
  },
  (table) => [
    uniqueIndex('listings_slug_unique').on(table.slug),
    uniqueIndex('listings_unit_unique').on(table.unitId),
    index('listings_org_idx').on(table.organizationId),
  ],
);

export const mediaAssets = pgTable(
  'media_assets',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    uploadedByUserId: uuid('uploaded_by_user_id')
      .notNull()
      .references(() => users.id),
    privateObjectKey: text('private_object_key').notNull(),
    publicObjectKey: text('public_object_key'),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    byteSize: bigint('byte_size', { mode: 'bigint' }).notNull(),
    sha256: varchar('sha256', { length: 64 }),
    processingStatus: varchar('processing_status', { length: 32 }).notNull().default('pending'),
    scanStatus: varchar('scan_status', { length: 32 }).notNull().default('pending'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (table) => [index('media_assets_org_idx').on(table.organizationId)],
);

export const propertyDocuments = pgTable(
  'property_documents',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    mediaAssetId: uuid('media_asset_id').references(() => mediaAssets.id),
    documentType: varchar('document_type', { length: 40 }).notNull(),
    documentNumber: varchar('document_number', { length: 120 }),
    issuedOn: date('issued_on'),
    expiresOn: date('expires_on'),
    verificationStatus: varchar('verification_status', { length: 24 }).notNull().default('pending'),
    notes: text('notes'),
  },
  (table) => [
    index('property_documents_org_idx').on(table.organizationId),
    index('property_documents_property_idx').on(table.propertyId),
    check(
      'property_documents_type_check',
      sql`${table.documentType} IN ('title_deed', 'municipality', 'insurance', 'management_agreement', 'noc', 'floor_plan', 'other')`,
    ),
    check(
      'property_documents_verification_check',
      sql`${table.verificationStatus} IN ('pending', 'verified', 'rejected', 'expired')`,
    ),
  ],
);

export const unitMedia = pgTable(
  'unit_media',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    mediaAssetId: uuid('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    position: integer('position').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.unitId, table.mediaAssetId] }),
    index('unit_media_org_idx').on(table.organizationId),
  ],
);

export const holds = pgTable(
  'holds',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    prospectPartyId: uuid('prospect_party_id').references(() => parties.id),
    status: holdStatus('status').notNull().default('active'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    note: text('note'),
  },
  (table) => [
    index('holds_unit_status_idx').on(table.unitId, table.status),
    index('holds_org_idx').on(table.organizationId),
  ],
);

export const reservations = pgTable(
  'reservations',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    tenantPartyId: uuid('tenant_party_id')
      .notNull()
      .references(() => parties.id),
    status: reservationStatus('status').notNull().default('pending'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    convertedLeaseId: uuid('converted_lease_id'),
  },
  (table) => [
    index('reservations_unit_status_idx').on(table.unitId, table.status),
    index('reservations_org_idx').on(table.organizationId),
  ],
);

export const contractTemplates = pgTable(
  'contract_templates',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    key: varchar('key', { length: 80 }).notNull(),
    version: integer('version').notNull(),
    language: varchar('language', { length: 2 }).notNull(),
    html: text('html').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    active: boolean('active').notNull().default(false),
  },
  (table) => [
    uniqueIndex('contract_template_version_unique').on(
      table.organizationId,
      table.key,
      table.version,
      table.language,
    ),
  ],
);

export const contracts = pgTable(
  'contracts',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    templateVersionId: uuid('template_version_id')
      .notNull()
      .references(() => contractTemplates.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    ownerPartyId: uuid('owner_party_id')
      .notNull()
      .references(() => parties.id),
    tenantPartyId: uuid('tenant_party_id')
      .notNull()
      .references(() => parties.id),
    status: contractStatus('status').notNull().default('draft'),
    payloadSnapshot: jsonb('payload_snapshot').notNull(),
    renderedPdfObjectKey: text('rendered_pdf_object_key'),
    renderedPdfHash: varchar('rendered_pdf_hash', { length: 64 }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('contracts_org_idx').on(table.organizationId),
    index('contracts_tenant_idx').on(table.tenantPartyId),
  ],
);

export const contractSignatures = pgTable(
  'contract_signatures',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id),
    signerPartyId: uuid('signer_party_id')
      .notNull()
      .references(() => parties.id),
    signerRole: varchar('signer_role', { length: 32 }).notNull(),
    method: varchar('method', { length: 32 }).notNull(),
    evidence: jsonb('evidence').notNull(),
    signatureHash: varchar('signature_hash', { length: 64 }).notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('contract_signer_unique').on(
      table.contractId,
      table.signerPartyId,
      table.signerRole,
    ),
  ],
);

export const signatureChallenges = pgTable(
  'signature_challenges',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    authenticationMethod: varchar('authentication_method', { length: 40 }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [
    index('signature_challenges_contract_idx').on(table.contractId),
    index('signature_challenges_user_idx').on(table.userId),
  ],
);

export const leases = pgTable(
  'leases',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    contractId: uuid('contract_id').references(() => contracts.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    ownerPartyId: uuid('owner_party_id')
      .notNull()
      .references(() => parties.id),
    tenantPartyId: uuid('tenant_party_id')
      .notNull()
      .references(() => parties.id),
    status: leaseStatus('status').notNull().default('draft'),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    rentMinor: bigint('rent_minor', { mode: 'bigint' }).notNull(),
    depositMinor: bigint('deposit_minor', { mode: 'bigint' }),
    currency: varchar('currency', { length: 3 }).notNull(),
    minorUnit: integer('minor_unit').notNull(),
    billingDay: integer('billing_day').notNull(),
  },
  (table) => [
    index('leases_unit_status_idx').on(table.unitId, table.status),
    index('leases_org_idx').on(table.organizationId),
    check('leases_dates_check', sql`${table.endsOn} > ${table.startsOn}`),
  ],
);

export const invoiceSequences = pgTable(
  'invoice_sequences',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    year: integer('year').notNull(),
    nextValue: bigint('next_value', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.year] })],
);

export const invoices = pgTable(
  'invoices',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    leaseId: uuid('lease_id')
      .notNull()
      .references(() => leases.id),
    tenantPartyId: uuid('tenant_party_id')
      .notNull()
      .references(() => parties.id),
    invoiceNumber: varchar('invoice_number', { length: 64 }).notNull(),
    status: invoiceStatus('status').notNull().default('draft'),
    currency: varchar('currency', { length: 3 }).notNull(),
    minorUnit: integer('minor_unit').notNull(),
    subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' }).notNull(),
    taxMinor: bigint('tax_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    paidMinor: bigint('paid_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    issuedOn: date('issued_on').notNull(),
    dueOn: date('due_on').notNull(),
    publicTokenHash: varchar('public_token_hash', { length: 64 }),
    publicTokenExpiresAt: timestamp('public_token_expires_at', { withTimezone: true }),
    notes: text('notes'),
  },
  (table) => [
    uniqueIndex('invoices_org_number_unique').on(table.organizationId, table.invoiceNumber),
    uniqueIndex('invoices_public_token_unique').on(table.publicTokenHash),
    index('invoices_tenant_idx').on(table.tenantPartyId),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    description: varchar('description', { length: 500 }).notNull(),
    quantity: varchar('quantity', { length: 32 }).notNull(),
    unitAmountMinor: bigint('unit_amount_minor', { mode: 'bigint' }).notNull(),
    taxRateBasisPoints: integer('tax_rate_basis_points').notNull().default(0),
    subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' }).notNull(),
    taxMinor: bigint('tax_minor', { mode: 'bigint' }).notNull(),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
  },
  (table) => [index('invoice_lines_invoice_idx').on(table.invoiceId)],
);

export const payments = pgTable(
  'payments',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    status: paymentStatus('status').notNull().default('pending'),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    minorUnit: integer('minor_unit').notNull(),
    provider: varchar('provider', { length: 80 }).notNull(),
    providerReference: varchar('provider_reference', { length: 200 }).notNull(),
    method: varchar('method', { length: 32 }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    refundedMinor: bigint('refunded_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
  },
  (table) => [
    uniqueIndex('payments_provider_reference_unique').on(table.provider, table.providerReference),
    index('payments_invoice_idx').on(table.invoiceId),
    index('payments_org_idx').on(table.organizationId),
  ],
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    ...identityColumns,
    provider: varchar('provider', { length: 80 }).notNull(),
    providerEventId: varchar('provider_event_id', { length: 200 }).notNull(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    signatureVerified: boolean('signature_verified').notNull().default(false),
    status: varchar('status', { length: 32 }).notNull().default('received'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    failureCode: varchar('failure_code', { length: 100 }),
  },
  (table) => [
    uniqueIndex('webhook_provider_event_unique').on(table.provider, table.providerEventId),
  ],
);

export const maintenanceTickets = pgTable(
  'maintenance_tickets',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    openedByPartyId: uuid('opened_by_party_id').references(() => parties.id),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    title: varchar('title', { length: 160 }).notNull(),
    description: text('description').notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    priority: maintenancePriority('priority').notNull().default('normal'),
    status: maintenanceStatus('status').notNull().default('open'),
    blocksAvailability: boolean('blocks_availability').notNull().default(false),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    index('maintenance_org_idx').on(table.organizationId),
    index('maintenance_unit_status_idx').on(table.unitId, table.status),
  ],
);

export const operationalRequests = pgTable(
  'operational_requests',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    reference: varchar('reference', { length: 64 }).notNull(),
    type: varchar('type', { length: 60 }).notNull(),
    requesterPartyId: uuid('requester_party_id').references(() => parties.id),
    propertyId: uuid('property_id').references(() => properties.id),
    unitId: uuid('unit_id').references(() => units.id),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    subject: varchar('subject', { length: 200 }).notNull(),
    description: text('description'),
    priority: maintenancePriority('priority').notNull().default('normal'),
    status: workflowStatus('status').notNull().default('pending'),
    source: varchar('source', { length: 40 }).notNull().default('portal'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (table) => [
    uniqueIndex('operational_requests_org_reference_unique').on(
      table.organizationId,
      table.reference,
    ),
    index('operational_requests_org_status_idx').on(table.organizationId, table.status),
    index('operational_requests_unit_idx').on(table.unitId),
  ],
);

export const workTasks = pgTable(
  'work_tasks',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    reference: varchar('reference', { length: 64 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    category: varchar('category', { length: 60 }).notNull(),
    status: workflowStatus('status').notNull().default('pending'),
    priority: maintenancePriority('priority').notNull().default('normal'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    propertyId: uuid('property_id').references(() => properties.id),
    unitId: uuid('unit_id').references(() => units.id),
    relatedType: varchar('related_type', { length: 60 }),
    relatedId: uuid('related_id'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    checklist: jsonb('checklist')
      .$type<Array<{ label: string; done: boolean }>>()
      .notNull()
      .default([]),
  },
  (table) => [
    uniqueIndex('work_tasks_org_reference_unique').on(table.organizationId, table.reference),
    index('work_tasks_org_status_idx').on(table.organizationId, table.status),
    index('work_tasks_assignee_due_idx').on(table.assignedToUserId, table.dueAt),
  ],
);

export const viewingRequests = pgTable(
  'viewing_requests',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    reference: varchar('reference', { length: 64 }).notNull(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    prospectPartyId: uuid('prospect_party_id')
      .notNull()
      .references(() => parties.id),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    channel: varchar('channel', { length: 40 }).notNull().default('website'),
    status: viewingStatus('status').notNull().default('requested'),
    preferredAt: timestamp('preferred_at', { withTimezone: true }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    notes: text('notes'),
  },
  (table) => [
    uniqueIndex('viewing_requests_org_reference_unique').on(table.organizationId, table.reference),
    index('viewing_requests_org_status_idx').on(table.organizationId, table.status),
    index('viewing_requests_unit_idx').on(table.unitId),
  ],
);

export const salesDeals = pgTable(
  'sales_deals',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    reference: varchar('reference', { length: 64 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    unitId: uuid('unit_id').references(() => units.id),
    sellerPartyId: uuid('seller_party_id')
      .notNull()
      .references(() => parties.id),
    buyerPartyId: uuid('buyer_party_id').references(() => parties.id),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    status: salesDealStatus('status').notNull().default('lead'),
    askingPriceMinor: bigint('asking_price_minor', { mode: 'bigint' }).notNull(),
    offerPriceMinor: bigint('offer_price_minor', { mode: 'bigint' }),
    agreedPriceMinor: bigint('agreed_price_minor', { mode: 'bigint' }),
    commissionMinor: bigint('commission_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    currency: varchar('currency', { length: 3 }).notNull(),
    minorUnit: integer('minor_unit').notNull(),
    expectedClosingOn: date('expected_closing_on'),
    closedOn: date('closed_on'),
    notes: text('notes'),
  },
  (table) => [
    uniqueIndex('sales_deals_org_reference_unique').on(table.organizationId, table.reference),
    index('sales_deals_org_status_idx').on(table.organizationId, table.status),
    check(
      'sales_deals_prices_nonnegative',
      sql`${table.askingPriceMinor} >= 0 and ${table.commissionMinor} >= 0`,
    ),
  ],
);

export const vendors = pgTable(
  'vendors',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    partyId: uuid('party_id').references(() => parties.id),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    category: varchar('category', { length: 80 }).notNull(),
    phone: varchar('phone', { length: 40 }),
    email: varchar('email', { length: 320 }),
    taxRegistrationNumberEncrypted: text('tax_registration_number_encrypted'),
    ratingBasisPoints: integer('rating_basis_points').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (table) => [
    uniqueIndex('vendors_org_code_unique').on(table.organizationId, table.code),
    index('vendors_org_category_idx').on(table.organizationId, table.category),
    check('vendors_rating_check', sql`${table.ratingBasisPoints} between 0 and 500`),
  ],
);

export const maintenanceWorkOrders = pgTable(
  'maintenance_work_orders',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => maintenanceTickets.id),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    reference: varchar('reference', { length: 64 }).notNull(),
    status: workOrderStatus('status').notNull().default('draft'),
    scope: text('scope').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    estimateMinor: bigint('estimate_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    approvedMinor: bigint('approved_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    actualMinor: bigint('actual_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    currency: varchar('currency', { length: 3 }).notNull(),
    minorUnit: integer('minor_unit').notNull(),
    completionNotes: text('completion_notes'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('maintenance_work_orders_org_reference_unique').on(
      table.organizationId,
      table.reference,
    ),
    index('maintenance_work_orders_ticket_idx').on(table.ticketId),
    index('maintenance_work_orders_org_status_idx').on(table.organizationId, table.status),
    check(
      'maintenance_work_orders_amounts_nonnegative',
      sql`${table.estimateMinor} >= 0 and ${table.approvedMinor} >= 0 and ${table.actualMinor} >= 0`,
    ),
  ],
);

export const legalCases = pgTable(
  'legal_cases',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    reference: varchar('reference', { length: 64 }).notNull(),
    caseNumber: varchar('case_number', { length: 120 }),
    caseType: varchar('case_type', { length: 80 }).notNull(),
    title: varchar('title', { length: 240 }).notNull(),
    description: text('description'),
    propertyId: uuid('property_id').references(() => properties.id),
    unitId: uuid('unit_id').references(() => units.id),
    leaseId: uuid('lease_id').references(() => leases.id),
    counterpartyId: uuid('counterparty_id').references(() => parties.id),
    lawyerPartyId: uuid('lawyer_party_id').references(() => parties.id),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    court: varchar('court', { length: 200 }),
    status: legalCaseStatus('status').notNull().default('assessment'),
    claimAmountMinor: bigint('claim_amount_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    recoveredAmountMinor: bigint('recovered_amount_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    currency: varchar('currency', { length: 3 }).notNull(),
    minorUnit: integer('minor_unit').notNull(),
    openedOn: date('opened_on').notNull(),
    nextHearingAt: timestamp('next_hearing_at', { withTimezone: true }),
    closedOn: date('closed_on'),
  },
  (table) => [
    uniqueIndex('legal_cases_org_reference_unique').on(table.organizationId, table.reference),
    index('legal_cases_org_status_idx').on(table.organizationId, table.status),
    index('legal_cases_next_hearing_idx').on(table.nextHearingAt),
    check(
      'legal_cases_amounts_nonnegative',
      sql`${table.claimAmountMinor} >= 0 and ${table.recoveredAmountMinor} >= 0`,
    ),
  ],
);

export const legalEvents = pgTable(
  'legal_events',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    legalCaseId: uuid('legal_case_id')
      .notNull()
      .references(() => legalCases.id),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    type: varchar('type', { length: 60 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    notes: text('notes'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
  },
  (table) => [
    index('legal_events_case_time_idx').on(table.legalCaseId, table.occurredAt),
    index('legal_events_org_deadline_idx').on(table.organizationId, table.deadlineAt),
  ],
);

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    parentId: uuid('parent_id'),
    code: varchar('code', { length: 40 }).notNull(),
    nameAr: varchar('name_ar', { length: 160 }).notNull(),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    type: ledgerAccountType('type').notNull(),
    currency: varchar('currency', { length: 3 }),
    active: boolean('active').notNull().default(true),
    system: boolean('system').notNull().default(false),
  },
  (table) => [
    uniqueIndex('ledger_accounts_org_code_unique').on(table.organizationId, table.code),
    index('ledger_accounts_org_type_idx').on(table.organizationId, table.type),
  ],
);

export const journalEntries = pgTable(
  'journal_entries',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    reference: varchar('reference', { length: 64 }).notNull(),
    occurredOn: date('occurred_on').notNull(),
    description: varchar('description', { length: 500 }).notNull(),
    status: journalStatus('status').notNull().default('draft'),
    sourceType: varchar('source_type', { length: 60 }),
    sourceId: uuid('source_id'),
    postedByUserId: uuid('posted_by_user_id').references(() => users.id),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    reversalOfId: uuid('reversal_of_id'),
  },
  (table) => [
    uniqueIndex('journal_entries_org_reference_unique').on(table.organizationId, table.reference),
    index('journal_entries_org_date_idx').on(table.organizationId, table.occurredOn),
  ],
);

export const journalLines = pgTable(
  'journal_lines',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    journalEntryId: uuid('journal_entry_id')
      .notNull()
      .references(() => journalEntries.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    partyId: uuid('party_id').references(() => parties.id),
    propertyId: uuid('property_id').references(() => properties.id),
    unitId: uuid('unit_id').references(() => units.id),
    debitMinor: bigint('debit_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    creditMinor: bigint('credit_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    currency: varchar('currency', { length: 3 }).notNull(),
    minorUnit: integer('minor_unit').notNull(),
    memo: varchar('memo', { length: 500 }),
  },
  (table) => [
    index('journal_lines_entry_idx').on(table.journalEntryId),
    index('journal_lines_account_idx').on(table.accountId),
    check(
      'journal_lines_one_side_check',
      sql`(${table.debitMinor} > 0 and ${table.creditMinor} = 0) or (${table.creditMinor} > 0 and ${table.debitMinor} = 0)`,
    ),
  ],
);

export const expenses = pgTable(
  'expenses',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    reference: varchar('reference', { length: 64 }).notNull(),
    propertyId: uuid('property_id').references(() => properties.id),
    unitId: uuid('unit_id').references(() => units.id),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    workOrderId: uuid('work_order_id').references(() => maintenanceWorkOrders.id),
    category: varchar('category', { length: 80 }).notNull(),
    description: varchar('description', { length: 500 }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    taxMinor: bigint('tax_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    currency: varchar('currency', { length: 3 }).notNull(),
    minorUnit: integer('minor_unit').notNull(),
    status: workflowStatus('status').notNull().default('pending'),
    issuedOn: date('issued_on').notNull(),
    dueOn: date('due_on'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    notes: text('notes'),
  },
  (table) => [
    uniqueIndex('expenses_org_reference_unique').on(table.organizationId, table.reference),
    index('expenses_org_status_idx').on(table.organizationId, table.status),
    check(
      'expenses_amounts_nonnegative',
      sql`${table.amountMinor} >= 0 and ${table.taxMinor} >= 0`,
    ),
  ],
);

export const approvalRequests = pgTable(
  'approval_requests',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    reference: varchar('reference', { length: 64 }).notNull(),
    type: varchar('type', { length: 80 }).notNull(),
    subject: varchar('subject', { length: 240 }).notNull(),
    resourceType: varchar('resource_type', { length: 80 }).notNull(),
    resourceId: uuid('resource_id').notNull(),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    status: workflowStatus('status').notNull().default('pending'),
    decisionNote: text('decision_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('approval_requests_org_reference_unique').on(table.organizationId, table.reference),
    index('approval_requests_org_status_idx').on(table.organizationId, table.status),
  ],
);

export const workflowEvents = pgTable(
  'workflow_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    resourceType: varchar('resource_type', { length: 80 }).notNull(),
    resourceId: uuid('resource_id').notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    fromStatus: varchar('from_status', { length: 60 }),
    toStatus: varchar('to_status', { length: 60 }),
    note: text('note'),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('workflow_events_resource_time_idx').on(
      table.organizationId,
      table.resourceType,
      table.resourceId,
      table.occurredAt,
    ),
  ],
);

export const paymentGatewaySettings = pgTable(
  'payment_gateway_settings',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    provider: varchar('provider', { length: 80 }).notNull(),
    endpoint: text('endpoint').notNull(),
    credentialsEncrypted: text('credentials_encrypted').notNull(),
    encryptionVersion: varchar('encryption_version', { length: 16 }).notNull(),
    active: boolean('active').notNull().default(false),
  },
  (table) => [uniqueIndex('gateway_org_provider_unique').on(table.organizationId, table.provider)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    key: varchar('key', { length: 200 }).notNull(),
    route: varchar('route', { length: 300 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.key, table.route] }),
    index('idempotency_expiry_idx').on(table.expiresAt),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: varchar('action', { length: 160 }).notNull(),
    resourceType: varchar('resource_type', { length: 100 }).notNull(),
    resourceId: uuid('resource_id'),
    requestId: varchar('request_id', { length: 80 }).notNull(),
    ipHash: varchar('ip_hash', { length: 64 }),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_org_time_idx').on(table.organizationId, table.occurredAt),
    uniqueIndex('audit_request_action_unique').on(table.requestId, table.action, table.resourceId),
  ],
);

export const reportJobs = pgTable(
  'report_jobs',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id),
    type: varchar('type', { length: 80 }).notNull(),
    format: varchar('format', { length: 16 }).notNull(),
    filters: jsonb('filters').notNull().default({}),
    status: varchar('status', { length: 32 }).notNull().default('queued'),
    objectKey: text('object_key'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [index('report_jobs_org_idx').on(table.organizationId)],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    topic: varchar('topic', { length: 160 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 100 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
  },
  (table) => [index('outbox_unpublished_idx').on(table.publishedAt, table.occurredAt)],
);
