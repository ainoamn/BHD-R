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
    depositMinor: bigint('deposit_minor', { mode: 'bigint' }),
    currency: varchar('currency', { length: 3 }).notNull(),
    minorUnit: integer('minor_unit').notNull(),
    publishWhenAvailable: boolean('publish_when_available').notNull().default(false),
    status: lifecycleStatus('status').notNull().default('draft'),
  },
  (table) => [
    uniqueIndex('units_property_code_unique').on(table.propertyId, table.code),
    index('units_org_idx').on(table.organizationId),
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
