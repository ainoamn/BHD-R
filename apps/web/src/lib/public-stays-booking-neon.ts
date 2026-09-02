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
  cleaningFeeMinor: string | null;
};

async function resolveListingContext(slug: string): Promise<ListingContext> {
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
    cleaningFeeMinor: row.cleaning_fee_minor,
  };
}

async function isRangeAvailableInTransaction(
  transaction: Tx,
  organizationId: string,
  unitId: string,
  checkInOn: string,
  checkOutOn: string,
): Promise<boolean> {
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

  const conflicts = await transaction.execute(sql`
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
  return (conflictRows[0]?.count ?? '0') === '0';
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
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${input.unitId}::text))`);
  await releaseExpiredHoldsInTransaction(transaction, input.organizationId);

  try {
    const inserted = await transaction.execute(sql`
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
        ${input.expiresAt ?? null},
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
      payload: { unitId: input.unitId, kind: input.kind, stayRange },
    });

    return { id: row.id };
  } catch (error) {
    if (error instanceof PublicStayBookingError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('stay_inventory_locks_no_overlap_active') ||
      message.includes('exclusion_violation') ||
      message.includes('conflicting key')
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
  const ctx = await resolveListingContext(slug);
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
  const ctx = await resolveListingContext(slug);
  assertOrgEnabled(ctx.organizationId);

  const guests = query.adults + query.children;
  if (guests > ctx.maxGuests) {
    return { available: false as const, reason: 'guests_exceed_max' as const };
  }
  const nights = nightsBetween({ checkInOn: query.checkInOn, checkOutOn: query.checkOutOn });
  if (nights < ctx.minNights || nights > ctx.maxNights) {
    return { available: false as const, reason: 'nights_out_of_range' as const, nights };
  }
  const available = await asPublic((transaction) =>
    isRangeAvailableInTransaction(
      transaction,
      ctx.organizationId,
      ctx.unitId,
      query.checkInOn,
      query.checkOutOn,
    ),
  );
  return { available, nights, unitId: ctx.unitId, currency: ctx.currency };
}

export async function createPublicStayQuoteOnNeon(slug: string, input: CreateStayQuoteInput) {
  assertPlatformEnabled();
  const ctx = await resolveListingContext(slug);
  assertOrgEnabled(ctx.organizationId);

  const guests = input.adults + input.children;
  if (guests > ctx.maxGuests) {
    throw new PublicStayBookingError('guests_exceed_max', 'Guest count exceeds unit maximum', 409);
  }
  const nights = nightsBetween({ checkInOn: input.checkInOn, checkOutOn: input.checkOutOn });
  if (nights < ctx.minNights || nights > ctx.maxNights) {
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
      input.checkInOn,
      input.checkOutOn,
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
        AND stay_date >= ${input.checkInOn}::date
        AND stay_date < ${input.checkOutOn}::date
        AND effective_rate_minor IS NOT NULL
    `);
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    const map: Record<string, string> = {};
    for (const row of rows as Array<{ stay_date: string; effective_rate_minor: string }>) {
      map[row.stay_date] = row.effective_rate_minor;
    }
    return map;
  });

  const priced = quoteStay({
    currency: ctx.currency,
    checkInOn: input.checkInOn,
    checkOutOn: input.checkOutOn,
    baseNightlyMinor: ctx.baseNightlyMinor,
    weekendNightlyMinor: ctx.weekendNightlyMinor,
    cleaningFeeMinor: ctx.cleaningFeeMinor,
    ...(Object.keys(nightRates).length ? { nightRateOverrides: nightRates } : {}),
  });

  const payloadHash = createHash('sha256')
    .update(
      JSON.stringify({
        unitId: ctx.unitId,
        checkInOn: input.checkInOn,
        checkOutOn: input.checkOutOn,
        adults: input.adults,
        children: input.children,
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
        checkInOn: input.checkInOn,
        checkOutOn: input.checkOutOn,
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
        feesSnapshotJson: [{ code: 'cleaning', amountMinor: priced.cleaningFeeMinor }],
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
        checkInOn: input.checkInOn,
        checkOutOn: input.checkOutOn,
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

    const available = await isRangeAvailableInTransaction(
      transaction,
      quote.organizationId,
      quote.unitId,
      quote.checkInOn,
      quote.checkOutOn,
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
      expiresAt,
      sourceType: 'stay_quote',
      sourceId: quote.id,
      note: 'Public stay hold',
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
