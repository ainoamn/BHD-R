import 'server-only';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import type { StayInventoryCalendarResponse } from '@bhd-r/contracts';
import {
  createDatabase,
  properties,
  stayBookings,
  stayBookingGuests,
  stayPaymentIntents,
  stayProfiles,
  units,
  type Database,
} from '@bhd-r/db';
import type { OpsStayBooking } from '@/components/stays/stay-ops-bookings-table';
import type { StayCalendarUnit } from '@/components/stays/stay-ops-calendar-panel';
import type { StayBookingContractData } from '@/components/stays/stay-booking-contract';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdROwnerStaysOpsDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdROwnerStaysOpsDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdROwnerStaysOpsDb = { db };
  }
  return globalForDb.__bhdROwnerStaysOpsDb;
}

async function withinTenant<T>(
  claims: SessionClaims,
  work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.organization_id', ${claims.organizationId ?? ''}, true)`,
    );
    await transaction.execute(sql`select set_config('app.user_id', ${claims.sub}, true)`);
    await transaction.execute(
      sql`select set_config('app.party_id', ${claims.partyId ?? ''}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.platform_admin', ${String(claims.roles.includes('platform_admin'))}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.is_tenant', ${String(claims.roles.includes('tenant'))}, true)`,
    );
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);
    return work(transaction);
  });
}

function assertOrg(claims: SessionClaims): string {
  if (!claims.organizationId) throw new Error('organization_required');
  return claims.organizationId;
}

function nightsBetween(checkInOn: string, checkOutOn: string): number {
  const start = Date.parse(`${checkInOn}T00:00:00.000Z`);
  const end = Date.parse(`${checkOutOn}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 86_400_000);
}

function toOpsBooking(row: {
  id: string;
  referenceCode: string;
  propertyId: string;
  unitId: string;
  checkInOn: string;
  checkOutOn: string;
  status: string;
  bookingMode: string;
  source: string;
  currency: string;
  totalMinor: bigint | string | number;
  propertyNameAr?: string | null;
  propertyNameEn?: string | null;
  unitCode?: string | null;
  unitNameAr?: string | null;
  unitNameEn?: string | null;
}): OpsStayBooking {
  return {
    id: row.id,
    referenceCode: row.referenceCode,
    propertyId: row.propertyId,
    unitId: row.unitId,
    checkInOn: row.checkInOn,
    checkOutOn: row.checkOutOn,
    status: row.status,
    bookingMode: row.bookingMode,
    source: row.source,
    currency: row.currency,
    totalMinor: String(row.totalMinor),
    nights: nightsBetween(row.checkInOn, row.checkOutOn),
    ...(row.propertyNameAr ? { propertyNameAr: row.propertyNameAr } : {}),
    ...(row.propertyNameEn ? { propertyNameEn: row.propertyNameEn } : {}),
    ...(row.unitCode ? { unitCode: row.unitCode } : {}),
    ...(row.unitNameAr ? { unitNameAr: row.unitNameAr } : {}),
    ...(row.unitNameEn ? { unitNameEn: row.unitNameEn } : {}),
  };
}

function readGuestContact(snapshot: unknown): {
  displayName?: string;
  email?: string;
  phone?: string;
  adults?: number;
  children?: number;
  stayType?: string;
} {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const root = snapshot as Record<string, unknown>;
  const contact =
    root.guestContact && typeof root.guestContact === 'object'
      ? (root.guestContact as Record<string, unknown>)
      : {};
  return {
    ...(typeof contact.displayName === 'string' ? { displayName: contact.displayName } : {}),
    ...(typeof contact.email === 'string' ? { email: contact.email } : {}),
    ...(typeof contact.phone === 'string' ? { phone: contact.phone } : {}),
    ...(typeof root.adults === 'number' ? { adults: root.adults } : {}),
    ...(typeof root.children === 'number' ? { children: root.children } : {}),
    ...(typeof root.stayType === 'string' ? { stayType: root.stayType } : {}),
  };
}

function paymentMethodLabel(provider: string | null | undefined, status: string): string {
  const paid = status === 'confirmed' || status === 'paid' || status === 'succeeded';
  if (!provider) return paid ? 'card' : 'pending';
  if (provider === 'sandbox') return 'sandbox_card';
  return provider;
}

export async function getOwnerStayBookingContractOnNeon(
  claims: SessionClaims,
  bookingId: string,
): Promise<StayBookingContractData | null> {
  const organizationId = assertOrg(claims);
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return null;

  return withinTenant(claims, async (transaction) => {
    const [row] = await transaction
      .select({
        id: stayBookings.id,
        referenceCode: stayBookings.referenceCode,
        propertyId: stayBookings.propertyId,
        unitId: stayBookings.unitId,
        checkInOn: stayBookings.checkInOn,
        checkOutOn: stayBookings.checkOutOn,
        status: stayBookings.status,
        bookingMode: stayBookings.bookingMode,
        source: stayBookings.source,
        currency: stayBookings.currency,
        totalMinor: stayBookings.totalMinor,
        createdAt: stayBookings.createdAt,
        pricingSnapshotJson: stayBookings.pricingSnapshotJson,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        unitCode: units.code,
        unitNameAr: units.nameAr,
        unitNameEn: units.nameEn,
      })
      .from(stayBookings)
      .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
      .innerJoin(units, eq(units.id, stayBookings.unitId))
      .where(
        and(eq(stayBookings.organizationId, organizationId), eq(stayBookings.id, bookingId)),
      )
      .limit(1);

    if (!row) return null;

    const [guest, intent] = await Promise.all([
      transaction
        .select({
          displayName: stayBookingGuests.displayName,
        })
        .from(stayBookingGuests)
        .where(
          and(
            eq(stayBookingGuests.organizationId, organizationId),
            eq(stayBookingGuests.bookingId, bookingId),
            eq(stayBookingGuests.isPrimary, true),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
      transaction
        .select({
          status: stayPaymentIntents.status,
          provider: stayPaymentIntents.provider,
          providerIntentId: stayPaymentIntents.providerIntentId,
          amountMinor: stayPaymentIntents.amountMinor,
          currency: stayPaymentIntents.currency,
          updatedAt: stayPaymentIntents.updatedAt,
        })
        .from(stayPaymentIntents)
        .where(
          and(
            eq(stayPaymentIntents.organizationId, organizationId),
            eq(stayPaymentIntents.bookingId, bookingId),
          ),
        )
        .orderBy(desc(stayPaymentIntents.updatedAt))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);

    const contact = readGuestContact(row.pricingSnapshotJson);
    const paid =
      row.status === 'confirmed' ||
      row.status === 'paid' ||
      intent?.status === 'succeeded';

    return {
      id: row.id,
      referenceCode: row.referenceCode,
      status: row.status,
      bookingMode: row.bookingMode,
      source: row.source,
      checkInOn: row.checkInOn,
      checkOutOn: row.checkOutOn,
      nights: nightsBetween(row.checkInOn, row.checkOutOn),
      currency: row.currency,
      totalMinor: String(row.totalMinor),
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      guestDisplayName: contact.displayName ?? guest?.displayName ?? null,
      guestEmail: contact.email ?? null,
      guestPhone: contact.phone ?? null,
      adults: contact.adults ?? null,
      children: contact.children ?? null,
      stayType: contact.stayType ?? null,
      propertyId: row.propertyId,
      propertyNameAr: row.propertyNameAr,
      propertyNameEn: row.propertyNameEn,
      unitId: row.unitId,
      unitCode: row.unitCode,
      unitNameAr: row.unitNameAr,
      unitNameEn: row.unitNameEn,
      paymentStatus: intent?.status ?? (paid ? 'succeeded' : 'pending'),
      paymentMethod: paymentMethodLabel(intent?.provider, row.status),
      paymentProviderRef: intent?.providerIntentId ?? null,
      paidAt:
        paid && intent?.updatedAt
          ? intent.updatedAt instanceof Date
            ? intent.updatedAt.toISOString()
            : String(intent.updatedAt)
          : null,
      paidAmountMinor: intent?.amountMinor != null ? String(intent.amountMinor) : null,
      paidCurrency: intent?.currency ?? null,
    };
  });
}

export async function listOwnerStayBookingsOnNeon(
  claims: SessionClaims,
  options?: { limit?: number },
): Promise<{ items: OpsStayBooking[] }> {
  const organizationId = assertOrg(claims);
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);

  return withinTenant(claims, async (transaction) => {
    const rows = await transaction
      .select({
        id: stayBookings.id,
        referenceCode: stayBookings.referenceCode,
        propertyId: stayBookings.propertyId,
        unitId: stayBookings.unitId,
        checkInOn: stayBookings.checkInOn,
        checkOutOn: stayBookings.checkOutOn,
        status: stayBookings.status,
        bookingMode: stayBookings.bookingMode,
        source: stayBookings.source,
        currency: stayBookings.currency,
        totalMinor: stayBookings.totalMinor,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        unitCode: units.code,
        unitNameAr: units.nameAr,
        unitNameEn: units.nameEn,
      })
      .from(stayBookings)
      .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
      .innerJoin(units, eq(units.id, stayBookings.unitId))
      .where(eq(stayBookings.organizationId, organizationId))
      .orderBy(desc(stayBookings.checkInOn), desc(stayBookings.createdAt))
      .limit(limit);

    return { items: rows.map(toOpsBooking) };
  });
}

export async function listOwnerStayCalendarUnitsOnNeon(
  claims: SessionClaims,
): Promise<{ items: StayCalendarUnit[] }> {
  const organizationId = assertOrg(claims);

  return withinTenant(claims, async (transaction) => {
    const rows = await transaction
      .select({
        unitId: stayProfiles.unitId,
        propertyId: units.propertyId,
        stayProfileId: stayProfiles.id,
        timezone: stayProfiles.timezone,
        unitCode: units.code,
      })
      .from(stayProfiles)
      .innerJoin(units, eq(units.id, stayProfiles.unitId))
      .where(eq(stayProfiles.organizationId, organizationId))
      .orderBy(asc(stayProfiles.createdAt));

    return {
      items: rows.map((row) => ({
        unitId: row.unitId,
        propertyId: row.propertyId,
        stayProfileId: row.stayProfileId,
        timezone: row.timezone,
        unitCode: row.unitCode,
        calendarPath: `/v1/stays/units/${row.unitId}/calendar.ics`,
      })),
    };
  });
}

function enumerateStayDates(fromOn: string, toOn: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${fromOn}T00:00:00.000Z`);
  const end = new Date(`${toOn}T00:00:00.000Z`);
  while (cursor < end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function fillInventoryCalendarDays(
  mapped: Array<{
    stayDate: string;
    availabilityStatus: string;
    effectiveRateMinor: string | null;
    currency: string | null;
    publicNote: string | null;
  }>,
  fromOn: string,
  toOn: string,
  defaults: {
    defaultAvailability: string;
    defaultRateMinor: string | null;
    defaultCurrency: string | null;
  },
): StayInventoryCalendarResponse['days'] {
  const byDate = new Map(mapped.map((day) => [day.stayDate, day]));
  return enumerateStayDates(fromOn, toOn).map((stayDate) => {
    const existing = byDate.get(stayDate);
    return {
      stayDate,
      availabilityStatus: (existing?.availabilityStatus ??
        defaults.defaultAvailability) as StayInventoryCalendarResponse['days'][number]['availabilityStatus'],
      effectiveRateMinor: existing?.effectiveRateMinor ?? defaults.defaultRateMinor ?? null,
      currency: (existing?.currency ??
        defaults.defaultCurrency) as StayInventoryCalendarResponse['days'][number]['currency'],
      publicNote: existing?.publicNote ?? null,
    };
  });
}

export async function getOwnerStayInventoryDaysOnNeon(
  claims: SessionClaims,
  unitId: string,
  fromOn: string,
  toOn: string,
): Promise<StayInventoryCalendarResponse> {
  const organizationId = assertOrg(claims);

  return withinTenant(claims, async (transaction) => {
    const [profile] = await transaction
      .select({ currency: stayProfiles.currency })
      .from(stayProfiles)
      .where(and(eq(stayProfiles.organizationId, organizationId), eq(stayProfiles.unitId, unitId)))
      .limit(1);
    if (!profile) throw new Error('stay_unit_not_found');

    // Keep calendar projection aligned with active booking locks (covers older paid stays).
    await transaction.execute(sql`
      WITH lock_days AS (
        SELECT DISTINCT gs::date AS stay_date
        FROM stay_inventory_locks l
        CROSS JOIN LATERAL generate_series(
          lower(l.stay_range),
          upper(l.stay_range) - 1,
          '1 day'::interval
        ) AS gs
        WHERE l.organization_id = ${organizationId}::uuid
          AND l.unit_id = ${unitId}::uuid
          AND l.status = 'active'
          AND l.kind = 'booking'
          AND lower(l.stay_range) < ${toOn}::date
          AND upper(l.stay_range) > ${fromOn}::date
      )
      INSERT INTO stay_inventory_days (
        organization_id, unit_id, stay_date, availability_status,
        effective_rate_minor, currency, min_nights, public_note, manual_rate
      )
      SELECT
        ${organizationId}::uuid,
        ${unitId}::uuid,
        ld.stay_date,
        'booked',
        NULL,
        ${profile.currency},
        NULL,
        NULL,
        false
      FROM lock_days ld
      WHERE ld.stay_date >= ${fromOn}::date
        AND ld.stay_date < ${toOn}::date
      ON CONFLICT (unit_id, stay_date) DO UPDATE SET
        availability_status = 'booked',
        updated_at = now()
    `);

    const dayResult = await transaction.execute(sql`
      SELECT
        stay_date::text AS stay_date,
        availability_status,
        effective_rate_minor::text AS effective_rate_minor,
        currency,
        public_note
      FROM stay_inventory_days
      WHERE organization_id = ${organizationId}::uuid
        AND unit_id = ${unitId}::uuid
        AND stay_date >= ${fromOn}::date
        AND stay_date < ${toOn}::date
      ORDER BY stay_date
    `);
    const dayRows = Array.isArray(dayResult)
      ? dayResult
      : ((dayResult as { rows?: unknown[] }).rows ?? []);
    const mapped = (
      dayRows as Array<{
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

    const days = fillInventoryCalendarDays(mapped, fromOn, toOn, {
      defaultAvailability: 'available',
      defaultRateMinor: null,
      defaultCurrency: profile.currency,
    });

    const lockResult = await transaction.execute(sql`
      SELECT
        l.kind::text AS kind,
        lower(l.stay_range)::text AS check_in_on,
        upper(l.stay_range)::text AS check_out_on,
        l.note,
        sb.reference_code AS booking_reference
      FROM stay_inventory_locks l
      LEFT JOIN stay_bookings sb
        ON sb.inventory_lock_id = l.id
       AND sb.organization_id = l.organization_id
      WHERE l.organization_id = ${organizationId}::uuid
        AND l.unit_id = ${unitId}::uuid
        AND l.status = 'active'
        AND lower(l.stay_range) < ${toOn}::date
        AND upper(l.stay_range) > ${fromOn}::date
      ORDER BY lower(l.stay_range) ASC, l.created_at ASC
    `);
    const lockRows = Array.isArray(lockResult)
      ? lockResult
      : ((lockResult as { rows?: unknown[] }).rows ?? []);

    const locks = (
      lockRows as Array<{
        kind: string;
        check_in_on: string;
        check_out_on: string;
        note: string | null;
        booking_reference: string | null;
      }>
    ).map((row) => ({
      kind: row.kind,
      checkInOn: row.check_in_on,
      checkOutOn: row.check_out_on,
      ...(row.booking_reference ? { bookingReference: row.booking_reference } : {}),
      ...(row.note ? { note: row.note } : {}),
    }));

    const daysWithLocks = days.map((day) => {
      const lock = locks.find(
        (item) => day.stayDate >= item.checkInOn && day.stayDate < item.checkOutOn,
      );
      if (!lock) return day;
      const fromLock =
        lock.kind === 'booking'
          ? 'booked'
          : lock.kind === 'hold'
            ? 'hold'
            : lock.kind === 'maintenance'
              ? 'maintenance'
              : lock.kind === 'lease'
                ? 'lease'
                : lock.kind === 'owner_block' || lock.kind === 'channel'
                  ? 'blocked'
                  : null;
      if (!fromLock) return day;
      return {
        ...day,
        availabilityStatus:
          fromLock as StayInventoryCalendarResponse['days'][number]['availabilityStatus'],
      };
    });

    return {
      unitId,
      fromOn,
      toOn,
      currency: profile.currency as StayInventoryCalendarResponse['currency'],
      days: daysWithLocks,
      locks,
    };
  });
}

export async function countOwnerStayBookingsOnNeon(claims: SessionClaims): Promise<{
  total: number;
  confirmed: number;
  pending: number;
}> {
  const organizationId = assertOrg(claims);
  return withinTenant(claims, async (transaction) => {
    const [row] = await transaction
      .select({
        total: sql<number>`count(*)::int`,
        confirmed: sql<number>`count(*) filter (where ${stayBookings.status} in ('confirmed', 'paid', 'pre_arrival', 'checked_in', 'checked_out'))::int`,
        pending: sql<number>`count(*) filter (where ${stayBookings.status} in ('payment_pending', 'request_pending'))::int`,
      })
      .from(stayBookings)
      .where(eq(stayBookings.organizationId, organizationId));
    return {
      total: Number(row?.total ?? 0),
      confirmed: Number(row?.confirmed ?? 0),
      pending: Number(row?.pending ?? 0),
    };
  });
}
