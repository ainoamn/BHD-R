import 'server-only';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  outboxEvents,
  properties,
  stayBookingStatusHistory,
  stayBookings,
  users,
  workflowEvents,
  type Database,
} from '@bhd-r/db';
import { assertStayBookingTransition } from '@bhd-r/domain';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type StayStampKind = 'check_in' | 'check_out';

/** When the guest actually arrived or left, as recorded by the host. */
export type StayStamp = {
  at: string;
  notes: string | null;
  recordedBy: string | null;
};

export type StayStamps = { checkIn: StayStamp | null; checkOut: StayStamp | null };

const TO_STATUS: Record<StayStampKind, 'checked_in' | 'checked_out'> = {
  check_in: 'checked_in',
  check_out: 'checked_out',
};

/** Hosts may enter a time a few minutes ahead of the server clock. */
const FUTURE_TOLERANCE_MS = 15 * 60_000;

function fail(code: string): never {
  throw new Error(code);
}

/** "2026-10-09T15:40" typed in Oman (UTC+4, no daylight saving) → Date. */
export function muscatLocalToDate(value: string): Date {
  return new Date(`${value}:00+04:00`);
}

function readStamp(metadata: unknown, fallbackAt: Date): StayStamp {
  const row = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
  const at = typeof row.at === 'string' && row.at ? row.at : fallbackAt.toISOString();
  const notes = typeof row.notes === 'string' && row.notes.trim() ? row.notes.trim() : null;
  const recordedBy =
    typeof row.recordedBy === 'string' && row.recordedBy.trim() ? row.recordedBy.trim() : null;
  return { at, notes, recordedBy };
}

/** Latest check-in / check-out stamps per booking, from the status history. */
export async function loadStayStamps(
  tx: Pick<Tx, 'select'>,
  orgId: string,
  bookingIds: string[],
): Promise<Map<string, StayStamps>> {
  const stamps = new Map<string, StayStamps>();
  if (!bookingIds.length) return stamps;
  const rows = await tx
    .select({
      bookingId: stayBookingStatusHistory.bookingId,
      toStatus: stayBookingStatusHistory.toStatus,
      metadata: stayBookingStatusHistory.metadataJson,
      createdAt: stayBookingStatusHistory.createdAt,
    })
    .from(stayBookingStatusHistory)
    .where(
      and(
        eq(stayBookingStatusHistory.organizationId, orgId),
        inArray(stayBookingStatusHistory.bookingId, bookingIds),
        inArray(stayBookingStatusHistory.toStatus, ['checked_in', 'checked_out']),
      ),
    )
    .orderBy(asc(stayBookingStatusHistory.createdAt));
  for (const row of rows) {
    const entry = stamps.get(row.bookingId) ?? { checkIn: null, checkOut: null };
    const stamp = readStamp(row.metadata, row.createdAt);
    if (row.toStatus === 'checked_in') entry.checkIn = stamp;
    else entry.checkOut = stamp;
    stamps.set(row.bookingId, entry);
  }
  return stamps;
}

/**
 * Host records the guest's arrival (check-in) or departure (check-out) with the
 * actual time and optional notes. The guest sees both on their stay page.
 */
export async function recordStayStampOnNeon(
  claims: SessionClaims,
  propertyId: string,
  bookingId: string,
  input: { kind: StayStampKind; at?: string | undefined; notes?: string | undefined },
): Promise<{ bookingStatus: string; stamp: StayStamp }> {
  if (!hasPermission(claims, 'stay.booking.manage')) fail('forbidden');
  const orgId = claims.organizationId ?? fail('organization_required');
  const ownerPartyId = ownerPartyScope(claims);
  const now = new Date();
  const at = input.at ? muscatLocalToDate(input.at) : now;
  if (Number.isNaN(at.getTime())) fail('invalid_body');
  if (at.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) fail('stay_time_in_future');
  const notes = input.notes?.trim() || null;
  const toStatus = TO_STATUS[input.kind];

  return withinViewerTenant(claims, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${bookingId}, 29))`);
    const [booking] = await tx
      .select({
        id: stayBookings.id,
        status: stayBookings.status,
        referenceCode: stayBookings.referenceCode,
        unitId: stayBookings.unitId,
        checkOutOn: stayBookings.checkOutOn,
      })
      .from(stayBookings)
      .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
      .where(
        and(
          eq(stayBookings.id, bookingId),
          eq(stayBookings.organizationId, orgId),
          eq(stayBookings.propertyId, propertyId),
          eq(properties.organizationId, orgId),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .limit(1);
    if (!booking) fail('booking_not_found');
    if (!assertStayBookingTransition(booking.status, toStatus).ok) fail('stay_status_invalid');

    if (input.kind === 'check_out') {
      const checkIn = (await loadStayStamps(tx, orgId, [booking.id])).get(booking.id)?.checkIn;
      if (checkIn && at.getTime() < Date.parse(checkIn.at)) fail('stay_checkout_before_checkin');
    }

    const [actor] = await tx
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    const stamp: StayStamp = {
      at: at.toISOString(),
      notes,
      recordedBy: actor?.displayName ?? null,
    };

    await tx
      .update(stayBookings)
      .set({ status: toStatus, updatedAt: now })
      .where(and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, orgId)));
    await tx.insert(stayBookingStatusHistory).values({
      organizationId: orgId,
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus,
      actorUserId: claims.sub,
      reason: input.kind === 'check_in' ? 'host_check_in' : 'host_check_out',
      metadataJson: stamp,
    });
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'stay_booking',
      resourceId: booking.id,
      eventType: `stay.${toStatus}`,
      fromStatus: booking.status,
      toStatus,
      metadata: { referenceCode: booking.referenceCode, at: stamp.at, notes },
    });
    if (input.kind === 'check_out') {
      await tx.insert(outboxEvents).values({
        organizationId: orgId,
        topic: 'stay.checked_out',
        aggregateType: 'stay_booking',
        aggregateId: booking.id,
        payload: { unitId: booking.unitId, checkOutOn: booking.checkOutOn },
      });
    }
    return { bookingStatus: toStatus, stamp };
  });
}
