/**
 * BHD R Stays Drizzle tables — separate from long-term leasing holds/reservations/leases.
 * Inventory truth lives in stay_inventory_locks (daterange + GiST exclusion in SQL).
 */
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations, parties, properties, units, users } from './schema.js';

const identityColumns = {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** PostgreSQL daterange — prefer half-open [) bounds at the application layer. */
export const daterange = customType<{ data: string; driverData: string }>({
  dataType: () => 'daterange',
});

export const stayUnitTypes = pgTable(
  'stay_unit_types',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    code: varchar('code', { length: 64 }).notNull(),
    nameAr: varchar('name_ar', { length: 160 }).notNull(),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    maxAdults: integer('max_adults').notNull().default(2),
    maxChildren: integer('max_children').notNull().default(0),
    maxGuests: integer('max_guests').notNull().default(2),
    bedrooms: integer('bedrooms').notNull().default(1),
    beds: integer('beds').notNull().default(1),
    bathrooms: integer('bathrooms').notNull().default(1),
    status: varchar('status', { length: 24 }).notNull().default('active'),
  },
  (table) => [
    uniqueIndex('stay_unit_types_org_property_code_unique').on(
      table.organizationId,
      table.propertyId,
      table.code,
    ),
    index('stay_unit_types_org_idx').on(table.organizationId),
    check(
      'stay_unit_types_status_check',
      sql`${table.status} IN ('draft', 'active', 'inactive', 'archived')`,
    ),
  ],
);

export const stayPolicies = pgTable(
  'stay_policies',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    kind: varchar('kind', { length: 32 }).notNull(),
    code: varchar('code', { length: 64 }).notNull(),
    nameAr: varchar('name_ar', { length: 160 }).notNull(),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    version: integer('version').notNull().default(1),
    bodyAr: text('body_ar'),
    bodyEn: text('body_en'),
    rulesJson: jsonb('rules_json').$type<Record<string, unknown>>().notNull().default({}),
    status: varchar('status', { length: 24 }).notNull().default('active'),
  },
  (table) => [
    uniqueIndex('stay_policies_org_kind_code_version_unique').on(
      table.organizationId,
      table.kind,
      table.code,
      table.version,
    ),
    index('stay_policies_org_idx').on(table.organizationId),
    check(
      'stay_policies_kind_check',
      sql`${table.kind} IN ('cancellation', 'house_rules', 'check_in', 'other')`,
    ),
  ],
);

export const stayProfiles = pgTable(
  'stay_profiles',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    unitTypeId: uuid('unit_type_id')
      .notNull()
      .references(() => stayUnitTypes.id),
    enabled: boolean('enabled').notNull().default(false),
    publishStatus: varchar('publish_status', { length: 24 }).notNull().default('draft'),
    instantBook: boolean('instant_book').notNull().default(false),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Muscat'),
    currency: varchar('currency', { length: 3 }).notNull().default('OMR'),
    minorUnit: integer('minor_unit').notNull().default(3),
    maxAdults: integer('max_adults').notNull().default(2),
    maxChildren: integer('max_children').notNull().default(0),
    maxGuests: integer('max_guests').notNull().default(2),
    minNights: integer('min_nights').notNull().default(1),
    maxNights: integer('max_nights').notNull().default(30),
    leadTimeHours: integer('lead_time_hours').notNull().default(0),
    advanceBookingDays: integer('advance_booking_days').notNull().default(365),
    checkInFrom: varchar('check_in_from', { length: 8 }),
    checkInUntil: varchar('check_in_until', { length: 8 }),
    checkOutUntil: varchar('check_out_until', { length: 8 }),
    dayUseCheckOutUntil: varchar('day_use_check_out_until', { length: 8 }),
    overnightCheckOutUntil: varchar('overnight_check_out_until', { length: 8 }),
    dayUseMaxGuests: integer('day_use_max_guests'),
    overnightMaxGuests: integer('overnight_max_guests'),
    depositMinor: bigint('deposit_minor', { mode: 'bigint' }),
    policiesAr: text('policies_ar'),
    policiesEn: text('policies_en'),
    policiesJson: jsonb('policies_json')
      .$type<
        | string[]
        | Partial<
            Record<
              'general' | 'cancellation' | 'events' | 'payment',
              { ar?: string | null | undefined; en?: string | null | undefined } | undefined
            >
          >
      >()
      .notNull()
      .default([]),
    instructionsAr: text('instructions_ar'),
    instructionsEn: text('instructions_en'),
    cancellationPolicyId: uuid('cancellation_policy_id').references(() => stayPolicies.id),
    houseRulesId: uuid('house_rules_id').references(() => stayPolicies.id),
  },
  (table) => [
    uniqueIndex('stay_profiles_unit_unique').on(table.unitId),
    index('stay_profiles_org_idx').on(table.organizationId),
    index('stay_profiles_unit_type_idx').on(table.unitTypeId),
    check(
      'stay_profiles_publish_status_check',
      sql`${table.publishStatus} IN ('draft', 'ready', 'published', 'unpublished')`,
    ),
  ],
);

export const stayPublicListings = pgTable(
  'stay_public_listings',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    unitTypeId: uuid('unit_type_id')
      .notNull()
      .references(() => stayUnitTypes.id),
    slug: varchar('slug', { length: 180 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    titleAr: varchar('title_ar', { length: 200 }).notNull(),
    titleEn: varchar('title_en', { length: 200 }).notNull(),
    summaryAr: text('summary_ar'),
    summaryEn: text('summary_en'),
    seoTitleAr: varchar('seo_title_ar', { length: 200 }),
    seoTitleEn: varchar('seo_title_en', { length: 200 }),
    seoDescriptionAr: text('seo_description_ar'),
    seoDescriptionEn: text('seo_description_en'),
  },
  (table) => [
    uniqueIndex('stay_public_listings_slug_unique').on(table.slug),
    index('stay_public_listings_org_idx').on(table.organizationId),
  ],
);

export const stayRatePlans = pgTable(
  'stay_rate_plans',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    stayProfileId: uuid('stay_profile_id').references(() => stayProfiles.id),
    unitTypeId: uuid('unit_type_id').references(() => stayUnitTypes.id),
    code: varchar('code', { length: 64 }).notNull(),
    nameAr: varchar('name_ar', { length: 160 }).notNull(),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    baseNightlyMinor: bigint('base_nightly_minor', { mode: 'bigint' }).notNull(),
    weekendNightlyMinor: bigint('weekend_nightly_minor', { mode: 'bigint' }),
    /** Day-use / no overnight stay price (إقامة بدون مبيت). */
    dayUseMinor: bigint('day_use_minor', { mode: 'bigint' }),
    /** Overnight-only price (مبيت فقط). */
    overnightOnlyMinor: bigint('overnight_only_minor', { mode: 'bigint' }),
    refundable: boolean('refundable').notNull().default(true),
    enabled: boolean('enabled').notNull().default(true),
    priority: integer('priority').notNull().default(100),
  },
  (table) => [
    index('stay_rate_plans_org_idx').on(table.organizationId),
    index('stay_rate_plans_profile_idx').on(table.stayProfileId),
  ],
);

export const stayRateRules = pgTable(
  'stay_rate_rules',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    ratePlanId: uuid('rate_plan_id')
      .notNull()
      .references(() => stayRatePlans.id),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    daysOfWeek: integer('days_of_week').array().notNull().default(sql`ARRAY[0,1,2,3,4,5,6]::integer[]`),
    adjustmentType: varchar('adjustment_type', { length: 24 }).notNull(),
    adjustmentMinor: bigint('adjustment_minor', { mode: 'bigint' }),
    adjustmentBps: integer('adjustment_bps'),
    minNights: integer('min_nights'),
    priority: integer('priority').notNull().default(100),
    enabled: boolean('enabled').notNull().default(true),
  },
  (table) => [
    index('stay_rate_rules_org_idx').on(table.organizationId),
    index('stay_rate_rules_plan_range_idx').on(table.ratePlanId, table.startsOn, table.endsOn),
    check(
      'stay_rate_rules_adjustment_type_check',
      sql`${table.adjustmentType} IN ('absolute', 'relative_bps')`,
    ),
  ],
);

export const stayFees = pgTable(
  'stay_fees',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    stayProfileId: uuid('stay_profile_id').references(() => stayProfiles.id),
    unitTypeId: uuid('unit_type_id').references(() => stayUnitTypes.id),
    code: varchar('code', { length: 64 }).notNull(),
    nameAr: varchar('name_ar', { length: 160 }).notNull(),
    nameEn: varchar('name_en', { length: 160 }).notNull(),
    feeKind: varchar('fee_kind', { length: 32 }).notNull(),
    calculationType: varchar('calculation_type', { length: 32 }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }),
    percentBps: integer('percent_bps'),
    currency: varchar('currency', { length: 3 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (table) => [
    index('stay_fees_org_idx').on(table.organizationId),
    check(
      'stay_fees_kind_check',
      sql`${table.feeKind} IN ('cleaning', 'service', 'extra_guest', 'deposit', 'local_tax', 'other')`,
    ),
    check(
      'stay_fees_calculation_type_check',
      sql`${table.calculationType} IN ('fixed', 'per_night', 'per_guest', 'percent')`,
    ),
  ],
);

export const stayInventoryLocks = pgTable(
  'stay_inventory_locks',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    stayRange: daterange('stay_range').notNull(),
    kind: varchar('kind', { length: 24 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('active'),
    sourceType: varchar('source_type', { length: 64 }),
    sourceId: uuid('source_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    note: text('note'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
  },
  (table) => [
    index('stay_inventory_locks_org_idx').on(table.organizationId),
    index('stay_inventory_locks_unit_status_idx').on(table.unitId, table.status),
    check(
      'stay_inventory_locks_kind_check',
      sql`${table.kind} IN ('hold', 'booking', 'owner_block', 'maintenance', 'lease', 'channel')`,
    ),
    check('stay_inventory_locks_status_check', sql`${table.status} IN ('active', 'released')`),
  ],
);

export const stayInventoryDays = pgTable(
  'stay_inventory_days',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    stayDate: date('stay_date').notNull(),
    availabilityStatus: varchar('availability_status', { length: 24 }).notNull().default('available'),
    effectiveRateMinor: bigint('effective_rate_minor', { mode: 'bigint' }),
    currency: varchar('currency', { length: 3 }),
    minNights: integer('min_nights'),
    publicNote: text('public_note'),
    manualRate: boolean('manual_rate').notNull().default(false),
  },
  (table) => [
    uniqueIndex('stay_inventory_days_unit_date_unique').on(table.unitId, table.stayDate),
    index('stay_inventory_days_org_idx').on(table.organizationId),
  ],
);

export const stayQuotes = pgTable(
  'stay_quotes',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    stayProfileId: uuid('stay_profile_id')
      .notNull()
      .references(() => stayProfiles.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    checkInOn: date('check_in_on').notNull(),
    checkOutOn: date('check_out_on').notNull(),
    nights: integer('nights').notNull(),
    adults: integer('adults').notNull().default(1),
    children: integer('children').notNull().default(0),
    currency: varchar('currency', { length: 3 }).notNull(),
    minorUnit: integer('minor_unit').notNull(),
    subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' }).notNull(),
    feesMinor: bigint('fees_minor', { mode: 'bigint' }).notNull().default(sql`0`),
    taxMinor: bigint('tax_minor', { mode: 'bigint' }).notNull().default(sql`0`),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    lineItemsJson: jsonb('line_items_json').$type<unknown[]>().notNull().default([]),
    feesSnapshotJson: jsonb('fees_snapshot_json').$type<unknown[]>().notNull().default([]),
    payloadHash: varchar('payload_hash', { length: 128 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('stay_quotes_org_idx').on(table.organizationId),
    index('stay_quotes_expires_idx').on(table.expiresAt),
  ],
);

export const stayHolds = pgTable(
  'stay_holds',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => stayQuotes.id),
    inventoryLockId: uuid('inventory_lock_id')
      .notNull()
      .references(() => stayInventoryLocks.id),
    status: varchar('status', { length: 24 }).notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
  },
  (table) => [
    index('stay_holds_org_idx').on(table.organizationId),
    index('stay_holds_status_expires_idx').on(table.status, table.expiresAt),
    check(
      'stay_holds_status_check',
      sql`${table.status} IN ('active', 'converted', 'expired', 'cancelled')`,
    ),
  ],
);

export const stayBookings = pgTable(
  'stay_bookings',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    unitTypeId: uuid('unit_type_id')
      .notNull()
      .references(() => stayUnitTypes.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    stayProfileId: uuid('stay_profile_id')
      .notNull()
      .references(() => stayProfiles.id),
    referenceCode: varchar('reference_code', { length: 32 }).notNull(),
    guestPartyId: uuid('guest_party_id').references(() => parties.id),
    userId: uuid('user_id').references(() => users.id),
    checkInOn: date('check_in_on').notNull(),
    checkOutOn: date('check_out_on').notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Muscat'),
    status: varchar('status', { length: 32 }).notNull(),
    bookingMode: varchar('booking_mode', { length: 24 }).notNull(),
    source: varchar('source', { length: 24 }).notNull().default('direct'),
    quoteId: uuid('quote_id').references(() => stayQuotes.id),
    holdId: uuid('hold_id').references(() => stayHolds.id),
    inventoryLockId: uuid('inventory_lock_id')
      .notNull()
      .references(() => stayInventoryLocks.id),
    currency: varchar('currency', { length: 3 }).notNull(),
    minorUnit: integer('minor_unit').notNull(),
    subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' }).notNull(),
    feesMinor: bigint('fees_minor', { mode: 'bigint' }).notNull().default(sql`0`),
    taxMinor: bigint('tax_minor', { mode: 'bigint' }).notNull().default(sql`0`),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    pricingSnapshotJson: jsonb('pricing_snapshot_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    policySnapshotJson: jsonb('policy_snapshot_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    countryPackSnapshotJson: jsonb('country_pack_snapshot_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (table) => [
    uniqueIndex('stay_bookings_org_reference_unique').on(table.organizationId, table.referenceCode),
    index('stay_bookings_org_status_idx').on(table.organizationId, table.status),
    index('stay_bookings_unit_dates_idx').on(table.unitId, table.checkInOn, table.checkOutOn),
    check(
      'stay_bookings_status_check',
      sql`${table.status} IN (
        'request_pending', 'payment_pending', 'confirmed', 'pre_arrival',
        'checked_in', 'checked_out', 'closed', 'cancelled', 'expired', 'payment_failed', 'no_show'
      )`,
    ),
    check('stay_bookings_mode_check', sql`${table.bookingMode} IN ('instant', 'request')`),
    check('stay_bookings_source_check', sql`${table.source} IN ('direct', 'admin', 'channel')`),
  ],
);

export const stayBookingGuests = pgTable(
  'stay_booking_guests',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => stayBookings.id),
    isPrimary: boolean('is_primary').notNull().default(false),
    displayName: varchar('display_name', { length: 160 }).notNull(),
    emailEncrypted: text('email_encrypted'),
    phoneEncrypted: text('phone_encrypted'),
    encryptionKeyVersion: varchar('encryption_key_version', { length: 16 }),
    guestType: varchar('guest_type', { length: 24 }).notNull().default('adult'),
  },
  (table) => [
    index('stay_booking_guests_org_idx').on(table.organizationId),
    index('stay_booking_guests_booking_idx').on(table.bookingId),
    check(
      'stay_booking_guests_type_check',
      sql`${table.guestType} IN ('adult', 'child', 'infant')`,
    ),
  ],
);

export const stayBookingStatusHistory = pgTable(
  'stay_booking_status_history',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => stayBookings.id),
    fromStatus: varchar('from_status', { length: 32 }),
    toStatus: varchar('to_status', { length: 32 }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    reason: text('reason'),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index('stay_booking_status_history_org_idx').on(table.organizationId),
    index('stay_booking_status_history_booking_idx').on(table.bookingId, table.createdAt),
  ],
);

export const stayFolios = pgTable(
  'stay_folios',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => stayBookings.id),
    status: varchar('status', { length: 24 }).notNull().default('open'),
    currency: varchar('currency', { length: 3 }).notNull(),
    balanceMinor: bigint('balance_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  },
  (table) => [
    index('stay_folios_org_idx').on(table.organizationId),
    index('stay_folios_booking_idx').on(table.bookingId),
    check('stay_folios_status_check', sql`${table.status} IN ('open', 'closed', 'void')`),
  ],
);

export const stayCharges = pgTable(
  'stay_charges',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    folioId: uuid('folio_id')
      .notNull()
      .references(() => stayFolios.id),
    chargeKind: varchar('charge_kind', { length: 32 }).notNull(),
    description: varchar('description', { length: 240 }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    quantity: integer('quantity').notNull().default(1),
    stayDate: date('stay_date'),
  },
  (table) => [
    index('stay_charges_org_idx').on(table.organizationId),
    index('stay_charges_folio_idx').on(table.folioId),
    check(
      'stay_charges_kind_check',
      sql`${table.chargeKind} IN ('night', 'cleaning', 'service', 'tax', 'deposit', 'adjustment', 'other')`,
    ),
  ],
);

export const stayPaymentIntents = pgTable(
  'stay_payment_intents',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => stayBookings.id),
    folioId: uuid('folio_id').references(() => stayFolios.id),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    provider: varchar('provider', { length: 64 }),
    providerIntentId: varchar('provider_intent_id', { length: 128 }),
    providerEventId: varchar('provider_event_id', { length: 128 }),
  },
  (table) => [
    uniqueIndex('stay_payment_intents_org_idempotency_unique').on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index('stay_payment_intents_org_idx').on(table.organizationId),
    check(
      'stay_payment_intents_status_check',
      sql`${table.status} IN ('pending', 'succeeded', 'failed', 'cancelled')`,
    ),
  ],
);

export const stayPaymentAllocations = pgTable(
  'stay_payment_allocations',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    paymentIntentId: uuid('payment_intent_id')
      .notNull()
      .references(() => stayPaymentIntents.id),
    folioId: uuid('folio_id')
      .notNull()
      .references(() => stayFolios.id),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
  },
  (table) => [index('stay_payment_allocations_org_idx').on(table.organizationId)],
);

export const stayRefunds = pgTable(
  'stay_refunds',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => stayBookings.id),
    paymentIntentId: uuid('payment_intent_id').references(() => stayPaymentIntents.id),
    status: varchar('status', { length: 24 }).notNull().default('requested'),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    reason: text('reason'),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
  },
  (table) => [
    index('stay_refunds_org_idx').on(table.organizationId),
    index('stay_refunds_booking_idx').on(table.bookingId),
    check(
      'stay_refunds_status_check',
      sql`${table.status} IN ('requested', 'approved', 'rejected', 'executed', 'failed')`,
    ),
  ],
);

export const stayReviews = pgTable(
  'stay_reviews',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => stayBookings.id),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    rating: integer('rating').notNull(),
    title: varchar('title', { length: 200 }),
    body: text('body'),
    prosText: text('pros_text'),
    consText: text('cons_text'),
    cleanliness: integer('cleanliness'),
    locationScore: integer('location_score'),
    valueScore: integer('value_score'),
    communication: integer('communication'),
    accuracy: integer('accuracy'),
    checkInScore: integer('check_in_score'),
    status: varchar('status', { length: 24 }).notNull().default('published'),
    moderatedByUserId: uuid('moderated_by_user_id').references(() => users.id),
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('stay_reviews_booking_unique').on(table.bookingId),
    index('stay_reviews_org_idx').on(table.organizationId),
    check('stay_reviews_rating_check', sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
    check(
      'stay_reviews_status_check',
      sql`${table.status} IN ('published', 'hidden', 'pending_moderation')`,
    ),
  ],
);

export const stayHousekeepingTasks = pgTable(
  'stay_housekeeping_tasks',
  {
    ...identityColumns,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => stayBookings.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    taskKind: varchar('task_kind', { length: 32 }).notNull().default('turnover'),
    status: varchar('status', { length: 24 }).notNull().default('open'),
    dueOn: date('due_on').notNull(),
    note: text('note'),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('stay_housekeeping_tasks_booking_kind_unique').on(table.bookingId, table.taskKind),
    index('stay_housekeeping_tasks_org_status_idx').on(table.organizationId, table.status),
    index('stay_housekeeping_tasks_unit_due_idx').on(table.unitId, table.dueOn),
    check(
      'stay_housekeeping_tasks_kind_check',
      sql`${table.taskKind} IN ('turnover', 'inspection', 'deep_clean', 'other')`,
    ),
    check(
      'stay_housekeeping_tasks_status_check',
      sql`${table.status} IN ('open', 'in_progress', 'done', 'cancelled')`,
    ),
  ],
);
