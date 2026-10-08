import 'server-only';
import { sql, type SQL } from 'drizzle-orm';

export type StaySlotStatus = 'available' | 'booked' | 'hold' | 'blocked';
export type StayDaySlots = { morning: StaySlotStatus; evening: StaySlotStatus };
export type StayRemainingSlot = 'morning' | 'evening';

type SqlExecutor = { execute(query: SQL): PromiseLike<unknown> };

const SLOT_RANK: Record<StaySlotStatus, number> = { available: 0, hold: 1, booked: 2, blocked: 3 };

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as T[];
}

let lockSlotColumnReady: boolean | null = null;

export async function hasLockSlotColumn(transaction: SqlExecutor): Promise<boolean> {
  if (lockSlotColumnReady != null) return lockSlotColumnReady;
  const result = await transaction.execute(sql`
    SELECT 1 AS ok
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stay_inventory_locks'
      AND column_name = 'lock_slot'
    LIMIT 1
  `);
  lockSlotColumnReady = rowsOf(result).length > 0;
  return lockSlotColumnReady;
}

/**
 * Morning/evening occupancy per date from active locks and live bookings.
 * Only dates touched by at least one lock or booking are returned.
 */
export async function loadStayDaySlots(
  transaction: SqlExecutor,
  input: {
    organizationId: string;
    unitId: string;
    fromOn: string;
    toOn: string;
    /** Owner views also treat booking requests awaiting approval as holds. */
    includeRequests?: boolean;
  },
): Promise<Map<string, StayDaySlots>> {
  const slotReady = await hasLockSlotColumn(transaction);
  const lockSlot = slotReady ? sql`COALESCE(l.lock_slot, 'full')` : sql`'full'`;
  const result = await transaction.execute(sql`
    WITH days AS (
      SELECT generate_series(
        ${input.fromOn}::date,
        (${input.toOn}::date - 1),
        '1 day'::interval
      )::date AS stay_date
    )
    SELECT
      d.stay_date::text AS stay_date,
      CASE l.kind WHEN 'booking' THEN 'booked' WHEN 'hold' THEN 'hold' ELSE 'blocked' END AS state,
      ${lockSlot}::text AS slot
    FROM days d
    INNER JOIN stay_inventory_locks l
      ON l.organization_id = ${input.organizationId}::uuid
     AND l.unit_id = ${input.unitId}::uuid
     AND l.status = 'active'
     AND (l.expires_at IS NULL OR l.expires_at > now())
     AND l.stay_range @> d.stay_date
    UNION ALL
    SELECT
      d.stay_date::text AS stay_date,
      CASE
        WHEN b.status IN ('confirmed', 'paid', 'pre_arrival', 'checked_in') THEN 'booked'
        ELSE 'hold'
      END AS state,
      CASE b.pricing_snapshot_json->>'stayType'
        WHEN 'day_use' THEN 'morning'
        WHEN 'overnight_only' THEN 'evening'
        ELSE 'full'
      END AS slot
    FROM days d
    INNER JOIN stay_bookings b
      ON b.organization_id = ${input.organizationId}::uuid
     AND b.unit_id = ${input.unitId}::uuid
     AND daterange(b.check_in_on, GREATEST(b.check_out_on, b.check_in_on + 1), '[)') @> d.stay_date
    LEFT JOIN stay_holds h ON h.id = b.hold_id
    WHERE b.status IN ('confirmed', 'paid', 'pre_arrival', 'checked_in')
       OR (b.status = 'payment_pending' AND h.status = 'active' AND h.expires_at > now())
       ${input.includeRequests ? sql`OR b.status = 'request_pending'` : sql``}
  `);

  const byDate = new Map<string, StayDaySlots>();
  for (const row of rowsOf<{ stay_date: string; state: StaySlotStatus; slot: string }>(result)) {
    const date = String(row.stay_date).slice(0, 10);
    const current = byDate.get(date) ?? { morning: 'available', evening: 'available' };
    const touchesMorning = row.slot !== 'evening';
    const touchesEvening = row.slot !== 'morning';
    if (touchesMorning && SLOT_RANK[row.state] > SLOT_RANK[current.morning]) {
      current.morning = row.state;
    }
    if (touchesEvening && SLOT_RANK[row.state] > SLOT_RANK[current.evening]) {
      current.evening = row.state;
    }
    byDate.set(date, current);
  }
  return byDate;
}

export type SlotPrices = {
  baseNightlyMinor: string | null;
  dayUseMinor: string | null;
  overnightOnlyMinor: string | null;
};

/** First enabled rate plan prices for a unit's stay profile. */
export async function loadStaySlotPrices(
  transaction: SqlExecutor,
  organizationId: string,
  unitId: string,
): Promise<SlotPrices> {
  const result = await transaction.execute(sql`
    SELECT
      srp.base_nightly_minor::text AS base_nightly_minor,
      srp.day_use_minor::text AS day_use_minor,
      srp.overnight_only_minor::text AS overnight_only_minor
    FROM stay_profiles sp
    INNER JOIN stay_rate_plans srp ON srp.stay_profile_id = sp.id AND srp.enabled = true
    WHERE sp.organization_id = ${organizationId}::uuid
      AND sp.unit_id = ${unitId}::uuid
    ORDER BY srp.priority ASC, srp.created_at ASC
    LIMIT 1
  `);
  const row = rowsOf<{
    base_nightly_minor: string | null;
    day_use_minor: string | null;
    overnight_only_minor: string | null;
  }>(result)[0];
  return {
    baseNightlyMinor: row?.base_nightly_minor ?? null,
    dayUseMinor: row?.day_use_minor ?? null,
    overnightOnlyMinor: row?.overnight_only_minor ?? null,
  };
}

/** Price of the slot still open on a partially booked day, matching quote fallbacks. */
export function remainingSlotRateMinor(slot: StayRemainingSlot, prices: SlotPrices): string | null {
  const own = slot === 'morning' ? prices.dayUseMinor : prices.overnightOnlyMinor;
  return own && own !== '0' ? own : prices.baseNightlyMinor;
}

const CLOSED_DAY = new Set(['blocked', 'maintenance', 'lease', 'unavailable']);

/**
 * Overlays slot occupancy on calendar days. A day with one free slot keeps a
 * booked/hold status (so overnight ranges stay blocked) and gains `remainingSlot`.
 */
export function applyStayDaySlots<
  T extends {
    stayDate: string;
    availabilityStatus: string;
    publicNote?: string | null | undefined;
  },
>(
  days: readonly T[],
  slotsByDate: Map<string, StayDaySlots>,
  prices: SlotPrices,
): Array<
  T & {
    slots?: StayDaySlots;
    remainingSlot?: StayRemainingSlot | null;
    remainingRateMinor?: string | null;
  }
> {
  return days.map((day) => {
    const publicNote =
      typeof day.publicNote === 'string' && day.publicNote.startsWith('slot:')
        ? null
        : day.publicNote;
    const base = { ...day, ...(day.publicNote !== undefined ? { publicNote } : {}) };
    const slots = slotsByDate.get(day.stayDate);
    if (!slots || CLOSED_DAY.has(day.availabilityStatus)) return base;

    const morningFree = slots.morning === 'available';
    const eveningFree = slots.evening === 'available';
    if (morningFree && eveningFree) return { ...base, slots };

    const taken = [slots.morning, slots.evening].filter((state) => state !== 'available');
    const worst = taken.reduce((a, b) => (SLOT_RANK[b] > SLOT_RANK[a] ? b : a));
    const availabilityStatus = worst as T['availabilityStatus'];
    const remainingSlot: StayRemainingSlot | null =
      worst === 'blocked' ? null : morningFree ? 'morning' : eveningFree ? 'evening' : null;
    return {
      ...base,
      availabilityStatus,
      slots,
      remainingSlot,
      remainingRateMinor: remainingSlot ? remainingSlotRateMinor(remainingSlot, prices) : null,
    };
  });
}
