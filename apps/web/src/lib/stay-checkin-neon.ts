import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  properties,
  stayBookingStatusHistory,
  stayBookings,
  stayProfiles,
  units,
  users,
  workflowEvents,
  type Database,
} from '@bhd-r/db';
import { assertStayBookingTransition } from '@bhd-r/domain';
import { appLink, notifyByEmail } from '@/lib/email-notify';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import {
  issueStayCheckinPass,
  openStayCheckinPass,
  verifyStayCheckinCode,
} from '@/lib/stay-checkin-pass';
import { assertStayCheckinWindow, stayArrivalWindow } from '@/lib/stay-checkin-window';

const ARRIVAL_READY = new Set(['confirmed', 'paid', 'pre_arrival']);

function fail(code: string): never {
  throw new Error(code);
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

type StayKey =
  | { token: string }
  | { reference: string; code: string };

type StayFacts = {
  id: string;
  referenceCode: string;
  status: string;
  organizationId: string;
  propertyId: string;
  propertyNameAr: string;
  unitCode: string;
  guestName: string;
  checkInOn: string;
  checkOutOn: string;
  checkInFrom: string | null;
  checkOutUntil: string | null;
};

async function loadStayById(tx: Pick<Tx, 'select'>, bookingId: string): Promise<StayFacts | null> {
  const [row] = await tx
    .select({
      id: stayBookings.id,
      referenceCode: stayBookings.referenceCode,
      status: stayBookings.status,
      organizationId: stayBookings.organizationId,
      propertyId: stayBookings.propertyId,
      propertyNameAr: properties.nameAr,
      unitCode: units.code,
      checkInOn: stayBookings.checkInOn,
      checkOutOn: stayBookings.checkOutOn,
      checkInFrom: stayProfiles.checkInFrom,
      checkOutUntil: stayProfiles.checkOutUntil,
      guestName: sql<string | null>`coalesce(
        ${stayBookings.pricingSnapshotJson}->'guestContact'->>'displayName',
        (select g.display_name from stay_booking_guests g
          where g.booking_id = ${stayBookings.id} and g.is_primary = true
          limit 1)
      )`,
    })
    .from(stayBookings)
    .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
    .leftJoin(units, eq(units.id, stayBookings.unitId))
    .leftJoin(stayProfiles, eq(stayProfiles.id, stayBookings.stayProfileId))
    .where(eq(stayBookings.id, bookingId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    referenceCode: row.referenceCode,
    status: row.status,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    propertyNameAr: row.propertyNameAr,
    unitCode: row.unitCode ?? '—',
    guestName: row.guestName?.trim() || '—',
    checkInOn: String(row.checkInOn).slice(0, 10),
    checkOutOn: String(row.checkOutOn).slice(0, 10),
    checkInFrom: row.checkInFrom ?? null,
    checkOutUntil: row.checkOutUntil ?? null,
  };
}

async function markNoShowInTx(tx: Tx, facts: StayFacts, now: Date): Promise<void> {
  if (!ARRIVAL_READY.has(facts.status)) return;
  if (!assertStayBookingTransition(facts.status, 'no_show').ok) return;
  await tx
    .update(stayBookings)
    .set({ status: 'no_show', updatedAt: now })
    .where(
      and(eq(stayBookings.id, facts.id), eq(stayBookings.organizationId, facts.organizationId)),
    );
  await tx.insert(stayBookingStatusHistory).values({
    organizationId: facts.organizationId,
    bookingId: facts.id,
    fromStatus: facts.status,
    toStatus: 'no_show',
    reason: 'auto_no_show_after_checkout',
    metadataJson: {
      at: now.toISOString(),
      source: 'checkin_window',
      checkOutOn: facts.checkOutOn,
    },
  });
  await tx.insert(workflowEvents).values({
    organizationId: facts.organizationId,
    actorUserId: null,
    resourceType: 'stay_booking',
    resourceId: facts.id,
    eventType: 'stay.no_show',
    fromStatus: facts.status,
    toStatus: 'no_show',
    metadata: {
      referenceCode: facts.referenceCode,
      reason: 'auto_no_show_after_checkout',
    },
  });
}

function enforceCheckinWindow(facts: StayFacts, now: Date = new Date()) {
  return assertStayCheckinWindow(
    {
      checkInOn: facts.checkInOn,
      checkOutOn: facts.checkOutOn,
      checkInFrom: facts.checkInFrom,
      checkOutUntil: facts.checkOutUntil,
    },
    now,
  );
}

/** Public: guest page loads a rotating sealed pass for a paid booking. */
export async function guestStayCheckinPass(referenceCode: string) {
  const { createDatabase } = await import('@bhd-r/db');
  const url = process.env.DATABASE_URL;
  if (!url) fail('db_unconfigured');
  const { db } = createDatabase(url, { max: 2 });
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.public', 'true', true)`);
    const [hit] = await tx
      .select({ id: stayBookings.id })
      .from(stayBookings)
      .where(eq(stayBookings.referenceCode, referenceCode.trim().toUpperCase()))
      .limit(1);
    if (!hit) fail('booking_not_found');
    let facts = (await loadStayById(tx, hit.id)) ?? fail('booking_not_found');
    const now = new Date();
    const window = enforceCheckinWindow(facts, now);
    if (!window.ok && window.code === 'stay_checkin_window_closed' && ARRIVAL_READY.has(facts.status)) {
      await markNoShowInTx(tx, facts, now);
      facts = { ...facts, status: 'no_show' };
    }
    if (facts.status === 'checked_in' || facts.status === 'checked_out' || facts.status === 'closed') {
      return { state: 'arrived' as const, referenceCode: facts.referenceCode, status: facts.status };
    }
    if (facts.status === 'no_show' || facts.status === 'cancelled') {
      return { state: 'expired' as const, referenceCode: facts.referenceCode, status: facts.status };
    }
    if (!ARRIVAL_READY.has(facts.status)) {
      return { state: 'not_ready' as const, referenceCode: facts.referenceCode, status: facts.status };
    }
    if (!window.ok && window.code === 'stay_checkin_too_early') {
      return {
        state: 'too_early' as const,
        referenceCode: facts.referenceCode,
        status: facts.status,
        opensAt: window.opensAt.toISOString(),
      };
    }
    const pass = issueStayCheckinPass(facts.id);
    return { state: 'pass' as const, referenceCode: facts.referenceCode, ...pass };
  });
}

async function resolveStayKey(tx: Pick<Tx, 'select'>, key: StayKey): Promise<StayFacts> {
  if ('token' in key) {
    const bookingId = openStayCheckinPass(key.token);
    if (!bookingId) fail('pass_invalid');
    const facts = await loadStayById(tx, bookingId);
    if (!facts) fail('booking_not_found');
    return facts;
  }
  const ref = key.reference.trim().toUpperCase();
  const [booking] = await tx
    .select({ id: stayBookings.id })
    .from(stayBookings)
    .where(eq(stayBookings.referenceCode, ref))
    .limit(1);
  if (!booking) fail('booking_not_found');
  if (!verifyStayCheckinCode(booking.id, key.code.trim())) fail('pass_invalid');
  const facts = await loadStayById(tx, booking.id);
  if (!facts) fail('booking_not_found');
  return facts;
}

function gatePayload(facts: StayFacts, alreadyArrived: boolean, arrivedAt: string | null) {
  return {
    ok: true as const,
    alreadyArrived,
    arrivedAt,
    reference: facts.referenceCode,
    guestName: facts.guestName,
    unitCode: facts.unitCode,
    propertyNameAr: facts.propertyNameAr,
    checkInOn: facts.checkInOn,
    checkOutOn: facts.checkOutOn,
  };
}

async function assertPropertyAccess(
  tx: Pick<Tx, 'select'>,
  claims: SessionClaims,
  facts: StayFacts,
  propertyId?: string | null,
) {
  if (propertyId && facts.propertyId !== propertyId) fail('wrong_property');
  const ownerPartyId = ownerPartyScope(claims);
  if (ownerPartyId) {
    const [owned] = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, facts.propertyId), eq(properties.ownerPartyId, ownerPartyId)))
      .limit(1);
    if (!owned) fail('forbidden');
  }
}

/** Staff preview of a scanned stay arrival pass. */
export async function previewStayGate(
  claims: SessionClaims,
  key: StayKey,
  propertyId?: string | null,
) {
  if (!hasPermission(claims, 'stay.booking.manage')) fail('forbidden');
  return withinViewerTenant(claims, async (tx) => {
    let facts = await resolveStayKey(tx, key);
    await assertPropertyAccess(tx, claims, facts, propertyId);
    const now = new Date();
    const window = enforceCheckinWindow(facts, now);
    if (!window.ok && window.code === 'stay_checkin_window_closed' && ARRIVAL_READY.has(facts.status)) {
      await markNoShowInTx(tx, facts, now);
      facts = { ...facts, status: 'no_show' };
      fail('stay_checkin_window_closed');
    }
    if (facts.status === 'checked_in' || facts.status === 'checked_out' || facts.status === 'closed') {
      const [stamp] = await tx
        .select({
          at: sql<string | null>`${stayBookingStatusHistory.metadataJson}->>'at'`,
          createdAt: stayBookingStatusHistory.createdAt,
        })
        .from(stayBookingStatusHistory)
        .where(
          and(
            eq(stayBookingStatusHistory.bookingId, facts.id),
            eq(stayBookingStatusHistory.toStatus, 'checked_in'),
          ),
        )
        .orderBy(desc(stayBookingStatusHistory.createdAt))
        .limit(1);
      return {
        ...gatePayload(facts, true, stamp?.at ?? stamp?.createdAt?.toISOString() ?? null),
        preview: true as const,
      };
    }
    if (!ARRIVAL_READY.has(facts.status)) fail('stay_not_ready');
    if (!window.ok) fail(window.code);
    return {
      ...gatePayload(facts, false, null),
      preview: true as const,
      opensAt: window.opensAt.toISOString(),
      closesAt: window.closesAt.toISOString(),
    };
  });
}

/** Staff confirms arrival from a scanned pass → checked_in (records wall-clock now). */
export async function confirmStayGate(
  claims: SessionClaims,
  key: StayKey,
  note?: string | null,
  propertyId?: string | null,
) {
  if (!hasPermission(claims, 'stay.booking.manage')) fail('forbidden');
  const orgId = claims.organizationId ?? fail('organization_required');
  return withinViewerTenant(claims, async (tx) => {
    const opened = await resolveStayKey(tx, key);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${opened.id}, 31))`);
    let facts = (await loadStayById(tx, opened.id)) ?? fail('booking_not_found');
    await assertPropertyAccess(tx, claims, facts, propertyId);
    const now = new Date();
    const window = enforceCheckinWindow(facts, now);
    if (!window.ok && window.code === 'stay_checkin_window_closed' && ARRIVAL_READY.has(facts.status)) {
      await markNoShowInTx(tx, facts, now);
      fail('stay_checkin_window_closed');
    }
    if (facts.status === 'checked_in' || facts.status === 'checked_out' || facts.status === 'closed') {
      const [stamp] = await tx
        .select({
          at: sql<string | null>`${stayBookingStatusHistory.metadataJson}->>'at'`,
          createdAt: stayBookingStatusHistory.createdAt,
        })
        .from(stayBookingStatusHistory)
        .where(
          and(
            eq(stayBookingStatusHistory.bookingId, facts.id),
            eq(stayBookingStatusHistory.toStatus, 'checked_in'),
          ),
        )
        .orderBy(desc(stayBookingStatusHistory.createdAt))
        .limit(1);
      return gatePayload(facts, true, stamp?.at ?? stamp?.createdAt?.toISOString() ?? now.toISOString());
    }
    if (!ARRIVAL_READY.has(facts.status)) fail('stay_not_ready');
    if (!window.ok) fail(window.code);
    if (!assertStayBookingTransition(facts.status, 'checked_in').ok) fail('stay_status_invalid');

    const [actor] = await tx
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    const at = now.toISOString();
    const notes = note?.trim() || null;

    await tx
      .update(stayBookings)
      .set({ status: 'checked_in', updatedAt: now })
      .where(and(eq(stayBookings.id, facts.id), eq(stayBookings.organizationId, orgId)));
    await tx.insert(stayBookingStatusHistory).values({
      organizationId: orgId,
      bookingId: facts.id,
      fromStatus: facts.status,
      toStatus: 'checked_in',
      actorUserId: claims.sub,
      reason: 'gate_scan',
      metadataJson: {
        at,
        notes,
        recordedBy: actor?.displayName ?? null,
        noteKeys: [],
        customNote: notes,
        important: false,
        source: 'stay_gate',
      },
    });
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'stay_booking',
      resourceId: facts.id,
      eventType: 'stay.checked_in',
      fromStatus: facts.status,
      toStatus: 'checked_in',
      metadata: {
        referenceCode: facts.referenceCode,
        at,
        source: 'stay_gate',
        notes,
      },
    });
    return gatePayload(facts, false, at);
  });
}

/**
 * Mark confirmed stays that passed check-out without arrival as no-show (auto-cancel).
 * Safe to run from cron every few minutes.
 */
export async function expireStayNoShowsOnNeon(): Promise<{ marked: number }> {
  const { elevatedTx, rowsOf } = await import('@/lib/elevated-db');
  return elevatedTx(async (tx) => {
    const rows = rowsOf<{
      id: string;
      status: string;
      organization_id: string;
      reference_code: string;
      property_id: string;
      check_in_on: string;
      check_out_on: string;
      check_in_from: string | null;
      check_out_until: string | null;
    }>(
      await tx.execute(sql`
        select b.id::text, b.status, b.organization_id::text, b.reference_code,
               b.property_id::text, b.check_in_on::text, b.check_out_on::text,
               sp.check_in_from, sp.check_out_until
        from stay_bookings b
        left join stay_profiles sp on sp.id = b.stay_profile_id
        where b.status in ('confirmed', 'paid', 'pre_arrival')
          and b.check_out_on <= (timezone('Asia/Muscat', now()))::date + 1
        limit 200
      `),
    );
    const now = new Date();
    let marked = 0;
    for (const row of rows) {
      const facts: StayFacts = {
        id: row.id,
        referenceCode: row.reference_code,
        status: row.status,
        organizationId: row.organization_id,
        propertyId: row.property_id,
        propertyNameAr: '',
        unitCode: '—',
        guestName: '—',
        checkInOn: String(row.check_in_on).slice(0, 10),
        checkOutOn: String(row.check_out_on).slice(0, 10),
        checkInFrom: row.check_in_from,
        checkOutUntil: row.check_out_until,
      };
      const { closesAt } = stayArrivalWindow(facts);
      if (now.getTime() < closesAt.getTime()) continue;
      await markNoShowInTx(tx as Tx, facts, now);
      marked += 1;
    }
    return { marked };
  });
}

/** Email owners/managers when a stay booking is paid or requested. */
export async function notifyOwnersOfStayBooking(input: {
  bookingId: string;
  organizationId: string;
  referenceCode: string;
  kind: 'requested' | 'confirmed';
}): Promise<void> {
  try {
    const { elevatedTx } = await import('@/lib/elevated-db');
    const facts = await elevatedTx(async (tx) => loadStayById(tx, input.bookingId));
    if (!facts) return;
    const requested = input.kind === 'requested';
    await notifyByEmail({
      orgId: input.organizationId,
      aggregateType: 'stay_booking',
      aggregateId: input.bookingId,
      audience: {
        managersOf: { orgId: input.organizationId, propertyId: facts.propertyId },
      },
      dedupeKey: `stay-${input.kind}:${input.bookingId}`,
      content: () => ({
        tone: 'booking' as const,
        subject: requested
          ? `طلب حجز إقامة بانتظار الاعتماد — ${input.referenceCode}`
          : `حجز إقامة جديد مؤكد — ${input.referenceCode}`,
        title: requested ? 'طلب حجز إقامة بانتظار الاعتماد' : 'حجز إقامة جديد مؤكد',
        intro: requested
          ? `${facts.guestName} طلب حجز الوحدة ${facts.unitCode} في ${facts.propertyNameAr} (${facts.checkInOn} → ${facts.checkOutOn}).`
          : `تم تأكيد حجز ${facts.guestName} للوحدة ${facts.unitCode} في ${facts.propertyNameAr} (${facts.checkInOn} → ${facts.checkOutOn}).`,
        details: [
          { label: 'المرجع', value: input.referenceCode },
          { label: 'العقار', value: facts.propertyNameAr },
          { label: 'الوحدة', value: facts.unitCode },
          { label: 'الوصول', value: facts.checkInOn },
          { label: 'المغادرة', value: facts.checkOutOn },
        ],
        cta: {
          label: 'فتح الحجوزات',
          url: appLink(
            `/ar/owner/properties/${facts.propertyId}?section=bookings&focus=${input.bookingId}`,
          ),
        },
      }),
    });
  } catch (error) {
    console.error('stay owner notify failed', error);
  }
}
