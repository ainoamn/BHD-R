import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { resolveStaysEnabledFromEnv, readStaysFlagsFromEnv } from '@bhd-r/config';
import type {
  CreateStayBookingInput,
  CreateStayHoldInput,
  CreateStayQuoteInput,
  StayAvailabilityQuery,
  StayInventoryCalendarQuery,
} from '@bhd-r/contracts';
import {
  createDatabase,
  outboxEvents,
  stayBookingGuests,
  stayBookingStatusHistory,
  stayBookings,
  stayFolios,
  stayHolds,
  stayInventoryLocks,
  stayPaymentIntents,
  stayQuotes,
  workflowEvents,
  type Database,
} from '@bhd-r/db';
import {
  fillInventoryCalendarDays,
  formatDaterangeLiteral,
  nightsBetween,
  quoteStay,
  stayRangeFullyAvailable,
  type StayBookingStatus,
  type SupportedCurrency,
} from '@bhd-r/domain';

const QUOTE_TTL_MS = 30 * 60_000;
const HOLD_TTL_MS = 15 * 60_000;

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRPublicStaysBookingDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRPublicStaysBookingDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRPublicStaysBookingDb = { db };
  }
  return globalForDb.__bhdRPublicStaysBookingDb;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

async function asPublic<T>(work: (transaction: Tx) => Promise<T>): Promise<T> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.public', 'true', true)`);
    await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
    return work(transaction);
  });
}

type StayTypeArg = 'overnight_stay' | 'day_use' | 'overnight_only';

/** day_use / overnight_only may arrive with checkOut === checkIn from the UI. */
function exclusiveStayRange(
  stayType: StayTypeArg,
  checkInOn: string,
  checkOutOn: string,
): { checkInOn: string; checkOutOn: string } {
  if (
    (stayType === 'day_use' || stayType === 'overnight_only') &&
    checkOutOn <= checkInOn
  ) {
    const next = new Date(`${checkInOn}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return { checkInOn, checkOutOn: next.toISOString().slice(0, 10) };
  }
  return { checkInOn, checkOutOn };
}

let lockSlotColumnReady: boolean | null = null;

async function hasLockSlotColumn(transaction: Tx): Promise<boolean> {
  if (lockSlotColumnReady != null) return lockSlotColumnReady;
  const result = await transaction.execute(sql`
    SELECT 1 AS ok
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stay_inventory_locks'
      AND column_name = 'lock_slot'
    LIMIT 1
  `);
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  lockSlotColumnReady = rows.length > 0;
  return lockSlotColumnReady;
}

export class PublicStayBookingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PublicStayBookingError';
  }
}

function assertPlatformEnabled(): void {
  if (!readStaysFlagsFromEnv().platformEnabled) {
    throw new PublicStayBookingError('not_found', 'Stays booking is not enabled', 404);
  }
}

function assertOrgEnabled(organizationId: string): void {
  const resolution = resolveStaysEnabledFromEnv({
    organizationId,
    propertyEnabled: true,
    unitEnabled: true,
  });
  if (!resolution.enabled) {
    throw new PublicStayBookingError('not_found', 'Stay listing not found', 404);
  }
}

type ListingContext = {
  organizationId: string;
  propertyId: string;
  unitTypeId: string;
  unitId: string;
  stayProfileId: string;
  slug: string;
  instantBook: boolean;
  currency: SupportedCurrency;
  minorUnit: number;
  maxGuests: number;
  minNights: number;
  maxNights: number;
  timezone: string;
  baseNightlyMinor: string;
  weekendNightlyMinor: string | null;
  dayUseMinor: string | null;
  overnightOnlyMinor: string | null;
  cleaningFeeMinor: string | null;
};

async function resolveListingContext(
  slug: string,
  unitId?: string | null,
): Promise<ListingContext> {
  const rows = await asPublic(async (transaction) => {
    const result = await transaction.execute(sql`
      SELECT
        spl.organization_id,
        spl.property_id,
        spl.unit_type_id,
        spl.slug,
        sp.id AS stay_profile_id,
        sp.unit_id,
        sp.instant_book,
        sp.currency,
        sp.minor_unit,
        sp.max_guests,
        sp.min_nights,
        sp.max_nights,
        sp.timezone,
        (
          SELECT srp.base_nightly_minor::text
          FROM stay_rate_plans srp
          WHERE srp.stay_profile_id = sp.id AND srp.enabled = true
          ORDER BY srp.priority ASC, srp.created_at ASC
          LIMIT 1
        ) AS base_nightly_minor,
        (
          SELECT srp.weekend_nightly_minor::text
          FROM stay_rate_plans srp
          WHERE srp.stay_profile_id = sp.id AND srp.enabled = true
          ORDER BY srp.priority ASC, srp.created_at ASC
          LIMIT 1
        ) AS weekend_nightly_minor,
        (
          SELECT srp.day_use_minor::text
          FROM stay_rate_plans srp
          WHERE srp.stay_profile_id = sp.id AND srp.enabled = true
          ORDER BY srp.priority ASC, srp.created_at ASC
          LIMIT 1
        ) AS day_use_minor,
        (
          SELECT srp.overnight_only_minor::text
          FROM stay_rate_plans srp
          WHERE srp.stay_profile_id = sp.id AND srp.enabled = true
          ORDER BY srp.priority ASC, srp.created_at ASC
          LIMIT 1
        ) AS overnight_only_minor,
        (
          SELECT sf.amount_minor::text
          FROM stay_fees sf
          WHERE sf.stay_profile_id = sp.id
            AND sf.enabled = true
            AND sf.fee_kind = 'cleaning'
          ORDER BY sf.created_at ASC
          LIMIT 1
        ) AS cleaning_fee_minor
      FROM stay_public_listings spl
      INNER JOIN stay_profiles sp
        ON sp.unit_type_id = spl.unit_type_id
       AND sp.organization_id = spl.organization_id
       AND sp.enabled = true
       AND sp.publish_status = 'published'
      INNER JOIN units u ON u.id = sp.unit_id AND u.organization_id = spl.organization_id
      WHERE spl.slug = ${slug}
        AND spl.enabled = true
        AND spl.published_at IS NOT NULL
        ${unitId ? sql`AND u.id = ${unitId}::uuid` : sql``}
      ORDER BY
        CASE WHEN COALESCE(u.bedrooms, 0) > 0 THEN 0 ELSE 1 END,
        u.bedrooms DESC NULLS LAST,
        sp.updated_at DESC
      LIMIT 1
    `);
    return Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  });

  const row = rows[0] as
    | {
        organization_id: string;
        property_id: string;
        unit_type_id: string;
        slug: string;
        stay_profile_id: string;
        unit_id: string;
        instant_book: boolean;
        currency: string;
        minor_unit: number;
        max_guests: number;
        min_nights: number;
        max_nights: number;
        timezone: string;
        base_nightly_minor: string | null;
        weekend_nightly_minor: string | null;
        day_use_minor: string | null;
        overnight_only_minor: string | null;
        cleaning_fee_minor: string | null;
      }
    | undefined;
  if (!row?.base_nightly_minor) {
    throw new PublicStayBookingError('not_found', 'Stay listing not found', 404);
  }

  return {
    organizationId: row.organization_id,
    propertyId: row.property_id,
    unitTypeId: row.unit_type_id,
    unitId: row.unit_id,
    stayProfileId: row.stay_profile_id,
    slug: row.slug,
    instantBook: row.instant_book,
    currency: row.currency as SupportedCurrency,
    minorUnit: row.minor_unit,
    maxGuests: row.max_guests,
    minNights: row.min_nights,
    maxNights: row.max_nights,
    timezone: row.timezone,
    baseNightlyMinor: row.base_nightly_minor,
    weekendNightlyMinor: row.weekend_nightly_minor,
    dayUseMinor: row.day_use_minor,
    overnightOnlyMinor: row.overnight_only_minor,
    cleaningFeeMinor: row.cleaning_fee_minor,
  };
}

/** Exported for payment race checks inside the same Neon transaction. */
export async function isRangeAvailableInTransaction(
  transaction: Tx,
  organizationId: string,
  unitId: string,
  checkInOn: string,
  checkOutOn: string,
  stayType: 'overnight_stay' | 'day_use' | 'overnight_only' = 'overnight_stay',
  excludeBookingId?: string,
): Promise<boolean> {
  const lockSlot =
    stayType === 'day_use' ? 'morning' : stayType === 'overnight_only' ? 'evening' : 'full';

  const slotReady = await hasLockSlotColumn(transaction);
  const conflicts = slotReady
    ? await transaction.execute(sql`
        SELECT count(*)::text AS count
        FROM stay_inventory_locks
        WHERE organization_id = ${organizationId}::uuid
          AND unit_id = ${unitId}::uuid
          AND status = 'active'
          AND stay_range && daterange(${checkInOn}::date, ${checkOutOn}::date, '[)')
          AND (
            lock_slot = 'full'
            OR ${lockSlot} = 'full'
            OR lock_slot = ${lockSlot}
          )
      `)
    : await transaction.execute(sql`
        SELECT count(*)::text AS count
        FROM stay_inventory_locks
        WHERE organization_id = ${organizationId}::uuid
          AND unit_id = ${unitId}::uuid
          AND status = 'active'
          AND stay_range && daterange(${checkInOn}::date, ${checkOutOn}::date, '[)')
      `);
  const conflictRows = Array.isArray(conflicts)
    ? conflicts
    : ((conflicts as { rows?: Array<{ count: string }> }).rows ?? []);
  if ((conflictRows[0]?.count ?? '0') !== '0') return false;

  // Also conflict with confirmed / pending bookings of incompatible stay types.
  const bookingRows = await transaction.execute(sql`
    SELECT id::text AS id, pricing_snapshot_json
    FROM stay_bookings
    WHERE organization_id = ${organizationId}::uuid
      AND unit_id = ${unitId}::uuid
      AND status IN (
        'payment_pending', 'confirmed', 'pre_arrival', 'checked_in'
      )
      AND daterange(check_in_on, check_out_on, '[)')
        && daterange(${checkInOn}::date, ${checkOutOn}::date, '[)')
  `);
  const bookings = Array.isArray(bookingRows)
    ? bookingRows
    : ((bookingRows as { rows?: unknown[] }).rows ?? []);
  for (const raw of bookings as Array<{ id: string; pricing_snapshot_json: unknown }>) {
    if (excludeBookingId && raw.id === excludeBookingId) continue;
    const otherType =
      raw.pricing_snapshot_json &&
      typeof raw.pricing_snapshot_json === 'object' &&
      typeof (raw.pricing_snapshot_json as { stayType?: unknown }).stayType === 'string'
        ? ((raw.pricing_snapshot_json as { stayType: string }).stayType as
            | 'overnight_stay'
            | 'day_use'
            | 'overnight_only')
        : 'overnight_stay';
    const otherSlot =
      otherType === 'day_use' ? 'morning' : otherType === 'overnight_only' ? 'evening' : 'full';
    if (lockSlot === 'full' || otherSlot === 'full' || lockSlot === otherSlot) {
      return false;
    }
  }

  if (stayType === 'overnight_stay') {
    const days = await transaction.execute(sql`
      SELECT stay_date::text AS stay_date, availability_status
      FROM stay_inventory_days
      WHERE organization_id = ${organizationId}::uuid
        AND unit_id = ${unitId}::uuid
        AND stay_date >= ${checkInOn}::date
        AND stay_date < ${checkOutOn}::date
      ORDER BY stay_date
    `);
    const rows = Array.isArray(days) ? days : ((days as { rows?: unknown[] }).rows ?? []);
    const mapped = (
      rows as Array<{ stay_date: string; availability_status: string }>
    ).map((item) => ({
      stayDate: item.stay_date,
      availabilityStatus: item.availability_status,
    }));
    if (mapped.length > 0) {
      return stayRangeFullyAvailable(mapped, { checkInOn, checkOutOn });
    }
  }

  return true;
}

async function releaseExpiredHoldsInTransaction(transaction: Tx, organizationId: string) {
  const now = new Date();
  const releasedLocks = await transaction
    .update(stayInventoryLocks)
    .set({ status: 'released', updatedAt: now })
    .where(
      and(
        eq(stayInventoryLocks.organizationId, organizationId),
        eq(stayInventoryLocks.kind, 'hold'),
        eq(stayInventoryLocks.status, 'active'),
        isNotNull(stayInventoryLocks.expiresAt),
        lte(stayInventoryLocks.expiresAt, now),
      ),
    )
    .returning({ id: stayInventoryLocks.id });

  if (releasedLocks.length > 0) {
    await transaction
      .update(stayHolds)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(stayHolds.organizationId, organizationId),
          eq(stayHolds.status, 'active'),
          lte(stayHolds.expiresAt, now),
        ),
      );
  }
}

async function createLockInTransaction(
  transaction: Tx,
  input: {
    organizationId: string;
    unitId: string;
    checkInOn: string;
    checkOutOn: string;
    kind: string;
    lockSlot?: 'morning' | 'evening' | 'full';
    expiresAt?: Date;
    sourceType?: string;
    sourceId?: string;
    note?: string;
  },
) {
  const stayRange = formatDaterangeLiteral({
    checkInOn: input.checkInOn,
    checkOutOn: input.checkOutOn,
  });
  const lockSlot = input.lockSlot ?? 'full';
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${input.unitId}::text))`);
  await releaseExpiredHoldsInTransaction(transaction, input.organizationId);
  const slotReady = await hasLockSlotColumn(transaction);

  try {
    const inserted = slotReady
      ? await transaction.execute(sql`
          INSERT INTO stay_inventory_locks (
            organization_id, unit_id, stay_range, kind, status, lock_slot,
            source_type, source_id, expires_at, note
          ) VALUES (
            ${input.organizationId}::uuid,
            ${input.unitId}::uuid,
            ${stayRange}::daterange,
            ${input.kind},
            'active',
            ${lockSlot},
            ${input.sourceType ?? null},
            ${input.sourceId ?? null},
            ${input.expiresAt ? input.expiresAt.toISOString() : null},
            ${input.note ?? null}
          )
          RETURNING id
        `)
      : await transaction.execute(sql`
          INSERT INTO stay_inventory_locks (
            organization_id, unit_id, stay_range, kind, status,
            source_type, source_id, expires_at, note
          ) VALUES (
            ${input.organizationId}::uuid,
            ${input.unitId}::uuid,
            ${stayRange}::daterange,
            ${input.kind},
            'active',
            ${input.sourceType ?? null},
            ${input.sourceId ?? null},
            ${input.expiresAt ? input.expiresAt.toISOString() : null},
            ${input.note ?? null}
          )
          RETURNING id
        `);
    const rows = Array.isArray(inserted)
      ? inserted
      : ((inserted as { rows?: unknown[] }).rows ?? []);
    const row = rows[0] as { id: string } | undefined;
    if (!row?.id) {
      throw new PublicStayBookingError('lock_failed', 'Failed to create inventory lock', 409);
    }

    await transaction.insert(outboxEvents).values({
      organizationId: input.organizationId,
      topic: 'stay.inventory.lock_created',
      aggregateType: 'stay_inventory_lock',
      aggregateId: row.id,
      payload: { unitId: input.unitId, kind: input.kind, stayRange, lockSlot },
    });

    return { id: row.id };
  } catch (error) {
    if (error instanceof PublicStayBookingError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('stay_inventory_locks_no_overlap_active') ||
      message.includes('stay_inventory_locks_slot_conflict') ||
      message.includes('exclusion_violation') ||
      message.includes('conflicting key') ||
      message.includes('23P01')
    ) {
      throw new PublicStayBookingError(
        'dates_unavailable',
        'Selected dates are no longer available',
        409,
      );
    }
    throw error;
  }
}

export async function getPublicStayCalendarOnNeon(
  slug: string,
  query: StayInventoryCalendarQuery,
) {
  assertPlatformEnabled();
  const ctx = await resolveListingContext(slug, query.unitId);
  assertOrgEnabled(ctx.organizationId);

  return asPublic(async (transaction) => {
    const result = await transaction.execute(sql`
      SELECT
        stay_date::text AS stay_date,
        availability_status,
        effective_rate_minor::text AS effective_rate_minor,
        currency,
        public_note
      FROM stay_inventory_days
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND unit_id = ${ctx.unitId}::uuid
        AND stay_date >= ${query.fromOn}::date
        AND stay_date < ${query.toOn}::date
      ORDER BY stay_date
    `);
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    const mapped = (
      rows as Array<{
        stay_date: string;
        availability_status: string;
        effective_rate_minor: string | null;
        currency: string | null;
        public_note: string | null;
      }>
    ).map((row) => ({
      stayDate: row.stay_date,
      availabilityStatus: row.availability_status,
      effectiveRateMinor: row.effective_rate_minor,
      currency: row.currency,
      publicNote: row.public_note,
    }));

    return {
      unitId: ctx.unitId,
      fromOn: query.fromOn,
      toOn: query.toOn,
      currency: ctx.currency,
      days: fillInventoryCalendarDays(mapped, query.fromOn, query.toOn, {
        defaultAvailability: 'available',
        defaultRateMinor: ctx.baseNightlyMinor,
        defaultCurrency: ctx.currency,
      }),
    };
  });
}

export async function getPublicStayAvailabilityOnNeon(
  slug: string,
  query: StayAvailabilityQuery,
) {
  assertPlatformEnabled();
  const ctx = await resolveListingContext(slug, query.unitId);
  assertOrgEnabled(ctx.organizationId);

  const guests = query.adults + query.children;
  if (guests > ctx.maxGuests) {
    return { available: false as const, reason: 'guests_exceed_max' as const };
  }
  const stayType = query.stayType ?? 'overnight_stay';
  const range = exclusiveStayRange(stayType, query.checkInOn, query.checkOutOn);
  let nights: number;
  try {
    nights = nightsBetween(range);
  } catch {
    return { available: false as const, reason: 'nights_out_of_range' as const, nights: 0 };
  }
  if (
    stayType === 'overnight_stay' &&
    (nights < ctx.minNights || nights > ctx.maxNights)
  ) {
    return { available: false as const, reason: 'nights_out_of_range' as const, nights };
  }
  if (stayType !== 'overnight_stay' && nights < 1) {
    return { available: false as const, reason: 'nights_out_of_range' as const, nights };
  }
  const available = await asPublic((transaction) =>
    isRangeAvailableInTransaction(
      transaction,
      ctx.organizationId,
      ctx.unitId,
      range.checkInOn,
      range.checkOutOn,
      stayType,
    ),
  );
  return {
    available,
    nights,
    unitId: ctx.unitId,
    currency: ctx.currency,
    ...(available ? {} : { reason: 'slot_taken' as const }),
  };
}

export async function createPublicStayQuoteOnNeon(slug: string, input: CreateStayQuoteInput) {
  assertPlatformEnabled();
  const ctx = await resolveListingContext(slug, input.unitId);
  assertOrgEnabled(ctx.organizationId);

  const guests = input.adults + input.children;
  if (guests > ctx.maxGuests) {
    throw new PublicStayBookingError('guests_exceed_max', 'Guest count exceeds unit maximum', 409);
  }
  const stayTypeEarly = input.stayType ?? 'overnight_stay';
  const range = exclusiveStayRange(stayTypeEarly, input.checkInOn, input.checkOutOn);
  let nights: number;
  try {
    nights = nightsBetween(range);
  } catch {
    throw new PublicStayBookingError(
      'nights_out_of_range',
      'Stay length is outside profile min/max nights',
      409,
    );
  }
  if (
    stayTypeEarly === 'overnight_stay' &&
    (nights < ctx.minNights || nights > ctx.maxNights)
  ) {
    throw new PublicStayBookingError(
      'nights_out_of_range',
      'Stay length is outside profile min/max nights',
      409,
    );
  }
  const available = await asPublic((transaction) =>
    isRangeAvailableInTransaction(
      transaction,
      ctx.organizationId,
      ctx.unitId,
      range.checkInOn,
      range.checkOutOn,
      stayTypeEarly,
    ),
  );
  if (!available) {
    throw new PublicStayBookingError('dates_unavailable', 'Selected dates are not available', 409);
  }

  const nightRates = await asPublic(async (transaction) => {
    const result = await transaction.execute(sql`
      SELECT stay_date::text AS stay_date, effective_rate_minor::text AS effective_rate_minor
      FROM stay_inventory_days
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND unit_id = ${ctx.unitId}::uuid
        AND stay_date >= ${range.checkInOn}::date
        AND stay_date < ${range.checkOutOn}::date
        AND effective_rate_minor IS NOT NULL
    `);
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    const map: Record<string, string> = {};
    for (const row of rows as Array<{ stay_date: string; effective_rate_minor: string }>) {
      map[row.stay_date] = row.effective_rate_minor;
    }
    return map;
  });

  const stayType = stayTypeEarly;
  const selectedBase =
    stayType === 'day_use'
      ? (ctx.dayUseMinor ?? ctx.baseNightlyMinor)
      : stayType === 'overnight_only'
        ? (ctx.overnightOnlyMinor ?? ctx.baseNightlyMinor)
        : ctx.baseNightlyMinor;
  if (!selectedBase || !/^\d+$/.test(selectedBase)) {
    throw new PublicStayBookingError(
      'dates_unavailable',
      'Stay pricing is not configured for this unit',
      409,
    );
  }
  // Day-use / overnight-only ignore weekend premium and per-day inventory overrides.
  const useInventoryOverrides = stayType === 'overnight_stay';
  const priced = quoteStay({
    currency: ctx.currency,
    checkInOn: range.checkInOn,
    checkOutOn: range.checkOutOn,
    baseNightlyMinor: selectedBase,
    weekendNightlyMinor:
      stayType === 'overnight_stay' ? ctx.weekendNightlyMinor : selectedBase,
    cleaningFeeMinor: ctx.cleaningFeeMinor,
    ...(useInventoryOverrides && Object.keys(nightRates).length
      ? { nightRateOverrides: nightRates }
      : {}),
  });

  const payloadHash = createHash('sha256')
    .update(
      JSON.stringify({
        unitId: ctx.unitId,
        checkInOn: range.checkInOn,
        checkOutOn: range.checkOutOn,
        adults: input.adults,
        children: input.children,
        stayType,
        totalMinor: priced.totalMinor,
      }),
    )
    .digest('hex');

  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);

  return asPublic(async (transaction) => {
    const [quote] = await transaction
      .insert(stayQuotes)
      .values({
        organizationId: ctx.organizationId,
        stayProfileId: ctx.stayProfileId,
        unitId: ctx.unitId,
        checkInOn: range.checkInOn,
        checkOutOn: range.checkOutOn,
        nights: priced.nights,
        adults: input.adults,
        children: input.children,
        currency: priced.currency,
        minorUnit: priced.minorUnit,
        subtotalMinor: BigInt(priced.subtotalMinor),
        feesMinor: BigInt(priced.cleaningFeeMinor),
        taxMinor: 0n,
        totalMinor: BigInt(priced.totalMinor),
        lineItemsJson: priced.nightLines,
        feesSnapshotJson: [
          { code: 'cleaning', amountMinor: priced.cleaningFeeMinor },
          { code: 'stay_type', stayType },
        ],
        payloadHash,
        expiresAt,
      })
      .returning();

    await transaction.insert(outboxEvents).values({
      organizationId: ctx.organizationId,
      topic: 'stay.quote.created',
      aggregateType: 'stay_quote',
      aggregateId: quote!.id,
      payload: {
        slug,
        unitId: ctx.unitId,
        checkInOn: range.checkInOn,
        checkOutOn: range.checkOutOn,
        totalMinor: priced.totalMinor,
        currency: priced.currency,
      },
    });

    return {
      id: quote!.id,
      nights: priced.nights,
      currency: priced.currency,
      subtotalMinor: priced.subtotalMinor,
      feesMinor: priced.cleaningFeeMinor,
      taxMinor: '0',
      totalMinor: priced.totalMinor,
      expiresAt: expiresAt.toISOString(),
    };
  });
}

export async function createPublicStayHoldOnNeon(
  input: CreateStayHoldInput,
  idempotencyKey: string,
) {
  assertPlatformEnabled();

  return asPublic(async (transaction) => {
    const existing = await transaction.query.stayHolds.findFirst({
      where: and(
        eq(stayHolds.idempotencyKey, idempotencyKey),
        eq(stayHolds.quoteId, input.quoteId),
      ),
    });
    if (existing) {
      return {
        id: existing.id,
        expiresAt: existing.expiresAt.toISOString(),
        duplicate: true as const,
      };
    }

    const quote = await transaction.query.stayQuotes.findFirst({
      where: eq(stayQuotes.id, input.quoteId),
    });
    if (!quote) {
      throw new PublicStayBookingError('quote_not_found', 'Stay quote not found', 404);
    }
    assertOrgEnabled(quote.organizationId);
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new PublicStayBookingError('quote_expired', 'Stay quote has expired', 409);
    }

    const stayTypeFromQuote = (() => {
      const fees = Array.isArray(quote.feesSnapshotJson) ? quote.feesSnapshotJson : [];
      for (const item of fees) {
        if (!item || typeof item !== 'object') continue;
        const row = item as { code?: string; stayType?: string };
        if (row.code === 'stay_type' && typeof row.stayType === 'string') {
          if (
            row.stayType === 'day_use' ||
            row.stayType === 'overnight_only' ||
            row.stayType === 'overnight_stay'
          ) {
            return row.stayType;
          }
        }
      }
      return 'overnight_stay' as const;
    })();
    const lockSlot =
      stayTypeFromQuote === 'day_use'
        ? ('morning' as const)
        : stayTypeFromQuote === 'overnight_only'
          ? ('evening' as const)
          : ('full' as const);

    const available = await isRangeAvailableInTransaction(
      transaction,
      quote.organizationId,
      quote.unitId,
      quote.checkInOn,
      quote.checkOutOn,
      stayTypeFromQuote,
    );
    if (!available) {
      throw new PublicStayBookingError(
        'dates_unavailable',
        'Selected dates are no longer available',
        409,
      );
    }

    const expiresAt = new Date(Date.now() + HOLD_TTL_MS);
    const lock = await createLockInTransaction(transaction, {
      organizationId: quote.organizationId,
      unitId: quote.unitId,
      checkInOn: quote.checkInOn,
      checkOutOn: quote.checkOutOn,
      kind: 'hold',
      lockSlot,
      expiresAt,
      sourceType: 'stay_quote',
      sourceId: quote.id,
      note: `Public stay hold · ${lockSlot}`,
    });

    const [hold] = await transaction
      .insert(stayHolds)
      .values({
        organizationId: quote.organizationId,
        quoteId: quote.id,
        inventoryLockId: lock.id,
        status: 'active',
        expiresAt,
        idempotencyKey,
      })
      .returning();

    await transaction.insert(outboxEvents).values({
      organizationId: quote.organizationId,
      topic: 'stay.hold.created',
      aggregateType: 'stay_hold',
      aggregateId: hold!.id,
      payload: {
        quoteId: quote.id,
        unitId: quote.unitId,
        inventoryLockId: lock.id,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return {
      id: hold!.id,
      expiresAt: expiresAt.toISOString(),
      duplicate: false as const,
    };
  });
}

export async function createPublicStayBookingOnNeon(
  input: CreateStayBookingInput,
  idempotencyKey: string,
) {
  assertPlatformEnabled();

  return asPublic(async (transaction) => {
    const hold = await transaction.query.stayHolds.findFirst({
      where: eq(stayHolds.id, input.holdId),
    });
    if (!hold) {
      throw new PublicStayBookingError('hold_not_found', 'Stay hold not found', 404);
    }
    assertOrgEnabled(hold.organizationId);
    if (hold.status !== 'active' || hold.expiresAt.getTime() <= Date.now()) {
      throw new PublicStayBookingError('hold_inactive', 'Stay hold is not active', 409);
    }

    const existingIntent = await transaction.query.stayPaymentIntents.findFirst({
      where: and(
        eq(stayPaymentIntents.organizationId, hold.organizationId),
        eq(stayPaymentIntents.idempotencyKey, idempotencyKey),
      ),
    });
    if (existingIntent) {
      const booking = await transaction.query.stayBookings.findFirst({
        where: eq(stayBookings.id, existingIntent.bookingId),
      });
      if (!booking) {
        throw new PublicStayBookingError('booking_missing', 'Booking missing for payment intent', 409);
      }
      return {
        bookingId: booking.id,
        referenceCode: booking.referenceCode,
        status: booking.status,
        paymentIntentId: existingIntent.id,
        amountMinor: existingIntent.amountMinor.toString(),
        currency: existingIntent.currency,
        duplicate: true as const,
      };
    }

    const quote = await transaction.query.stayQuotes.findFirst({
      where: eq(stayQuotes.id, hold.quoteId),
    });
    if (!quote) {
      throw new PublicStayBookingError('quote_not_found', 'Stay quote not found', 404);
    }

    const profile = await transaction.execute(sql`
      SELECT sut.property_id, sp.unit_type_id, sp.instant_book, sp.timezone
      FROM stay_profiles sp
      INNER JOIN stay_unit_types sut ON sut.id = sp.unit_type_id
      WHERE sp.id = ${quote.stayProfileId}::uuid
      LIMIT 1
    `);
    const profileRows = Array.isArray(profile)
      ? profile
      : ((profile as { rows?: unknown[] }).rows ?? []);
    const profileRow = profileRows[0] as
      | {
          property_id: string;
          unit_type_id: string;
          instant_book: boolean;
          timezone: string;
        }
      | undefined;
    if (!profileRow) {
      throw new PublicStayBookingError('profile_not_found', 'Stay profile not found', 404);
    }

    const bookingMode = profileRow.instant_book ? 'instant' : 'request';
    const status: StayBookingStatus =
      bookingMode === 'instant' ? 'payment_pending' : 'request_pending';
    const referenceCode = `ST-${randomBytes(4).toString('hex').toUpperCase()}`;

    const stayTypeFromFees = (() => {
      if (!Array.isArray(quote.feesSnapshotJson)) return null;
      for (const item of quote.feesSnapshotJson) {
        if (!item || typeof item !== 'object') continue;
        const row = item as { code?: string; stayType?: string };
        if (row.code === 'stay_type' && typeof row.stayType === 'string') return row.stayType;
      }
      return null;
    })();

    const [booking] = await transaction
      .insert(stayBookings)
      .values({
        organizationId: hold.organizationId,
        propertyId: profileRow.property_id,
        unitTypeId: profileRow.unit_type_id,
        unitId: quote.unitId,
        stayProfileId: quote.stayProfileId,
        referenceCode,
        checkInOn: quote.checkInOn,
        checkOutOn: quote.checkOutOn,
        timezone: profileRow.timezone,
        status,
        bookingMode,
        source: 'direct',
        quoteId: quote.id,
        holdId: hold.id,
        inventoryLockId: hold.inventoryLockId,
        currency: quote.currency,
        minorUnit: quote.minorUnit,
        subtotalMinor: quote.subtotalMinor,
        feesMinor: quote.feesMinor,
        taxMinor: quote.taxMinor,
        totalMinor: quote.totalMinor,
        pricingSnapshotJson: {
          lineItems: quote.lineItemsJson,
          fees: quote.feesSnapshotJson,
          adults: quote.adults,
          children: quote.children,
          ...(stayTypeFromFees ? { stayType: stayTypeFromFees } : {}),
          guestContact: {
            ...(input.guestDisplayName?.trim()
              ? { displayName: input.guestDisplayName.trim() }
              : {}),
            ...(input.guestEmail?.trim() ? { email: input.guestEmail.trim().toLowerCase() } : {}),
            ...(input.guestPhone?.trim() ? { phone: input.guestPhone.trim() } : {}),
          },
        },
      })
      .returning();

    if (input.guestDisplayName?.trim()) {
      await transaction.insert(stayBookingGuests).values({
        organizationId: hold.organizationId,
        bookingId: booking!.id,
        isPrimary: true,
        displayName: input.guestDisplayName.trim(),
        guestType: 'adult',
      });
    }

    await transaction.insert(stayBookingStatusHistory).values({
      organizationId: hold.organizationId,
      bookingId: booking!.id,
      fromStatus: null,
      toStatus: status,
      reason: 'public_booking_created',
    });

    const [folio] = await transaction
      .insert(stayFolios)
      .values({
        organizationId: hold.organizationId,
        bookingId: booking!.id,
        status: 'open',
        currency: quote.currency,
        balanceMinor: quote.totalMinor,
      })
      .returning();

    const [intent] = await transaction
      .insert(stayPaymentIntents)
      .values({
        organizationId: hold.organizationId,
        bookingId: booking!.id,
        folioId: folio!.id,
        status: 'pending',
        amountMinor: quote.totalMinor,
        currency: quote.currency,
        idempotencyKey,
      })
      .returning();

    await transaction
      .update(stayHolds)
      .set({ status: 'converted', updatedAt: new Date() })
      .where(
        and(
          eq(stayHolds.id, hold.id),
          eq(stayHolds.organizationId, hold.organizationId),
          eq(stayHolds.status, 'active'),
        ),
      );

    await transaction.insert(workflowEvents).values({
      organizationId: hold.organizationId,
      actorUserId: null,
      resourceType: 'stay_booking',
      resourceId: booking!.id,
      eventType: 'stay.booking.requested',
      fromStatus: null,
      toStatus: status,
    });

    await transaction.insert(outboxEvents).values({
      organizationId: hold.organizationId,
      topic: 'stay.booking.requested',
      aggregateType: 'stay_booking',
      aggregateId: booking!.id,
      payload: {
        holdId: hold.id,
        paymentIntentId: intent!.id,
        unitId: quote.unitId,
        totalMinor: quote.totalMinor.toString(),
        currency: quote.currency,
        status,
      },
    });

    return {
      bookingId: booking!.id,
      referenceCode: booking!.referenceCode,
      status: booking!.status,
      paymentIntentId: intent!.id,
      amountMinor: intent!.amountMinor.toString(),
      currency: intent!.currency,
      duplicate: false as const,
    };
  });
}
