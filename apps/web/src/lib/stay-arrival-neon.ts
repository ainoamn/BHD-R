import 'server-only';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
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
import {
  HANDOVER_DOCUMENT_MAX,
  HANDOVER_IMAGE_DATA_URL,
  HANDOVER_PHOTOS_MAX,
  HANDOVER_PHOTO_MAX,
  composeHandoverNotes,
  handoverDocumentKind,
  handoverNote,
  isHandoverPhotoSource,
  validHandoverPhone,
  type HandoverPhoto,
  type HandoverPhotoSource,
} from '@/lib/stay-handover';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type StayStampKind = 'check_in' | 'check_out';

/** Who received the keys at check-in; the document image itself is only served on request. */
export type StayRecipient = {
  name: string | null;
  phone: string | null;
  documentKind: string | null;
  hasDocument: boolean;
};

/** When the guest actually arrived or left, as recorded by the host. */
export type StayStamp = {
  at: string;
  notes: string | null;
  recordedBy: string | null;
  noteKeys: string[];
  /** The host's own words; `notes` also lists the chosen quick notes. */
  customNote: string | null;
  important: boolean;
  recipient: StayRecipient | null;
  /** Condition photos of the unit; the bytes are only served on request. */
  photos: HandoverPhoto[];
};

export type StayPhotoInput = {
  data: string;
  source: HandoverPhotoSource;
  takenAt?: string | undefined;
};

export type StayRecipientInput = {
  name?: string | undefined;
  phone: string;
  documentKind: string;
  document: string;
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

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

function readPhotos(value: unknown): HandoverPhoto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const sha256 = text(row.sha256);
    return sha256 && isHandoverPhotoSource(row.source)
      ? [{ index, source: row.source, takenAt: text(row.takenAt), sha256 }]
      : [];
  });
}

function readStamp(metadata: unknown, fallbackAt: Date, hasDocument: boolean): StayStamp {
  const row = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
  const recipient =
    row.recipient && typeof row.recipient === 'object'
      ? (row.recipient as Record<string, unknown>)
      : null;
  return {
    at: text(row.at) ?? fallbackAt.toISOString(),
    notes: text(row.notes),
    recordedBy: text(row.recordedBy),
    noteKeys: Array.isArray(row.noteKeys)
      ? row.noteKeys.filter((key): key is string => typeof key === 'string')
      : [],
    customNote: text(row.customNote),
    important: row.important === true,
    photos: readPhotos(row.photos),
    recipient: recipient
      ? {
          name: text(recipient.name),
          phone: text(recipient.phone),
          documentKind: text(recipient.documentKind),
          hasDocument,
        }
      : null,
  };
}

const DOCUMENT_DATA_URL = HANDOVER_IMAGE_DATA_URL;

/** One condition photo of a check-in / check-out as image bytes. */
export async function readHandoverPhoto(
  tx: Pick<Tx, 'select'>,
  orgId: string,
  bookingId: string,
  kind: StayStampKind,
  index: number,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const [row] = await tx
    .select({
      data: sql<
        string | null
      >`${stayBookingStatusHistory.metadataJson}->'photos'->${index}::int->>'data'`,
    })
    .from(stayBookingStatusHistory)
    .where(
      and(
        eq(stayBookingStatusHistory.organizationId, orgId),
        eq(stayBookingStatusHistory.bookingId, bookingId),
        eq(stayBookingStatusHistory.toStatus, TO_STATUS[kind]),
      ),
    )
    .orderBy(desc(stayBookingStatusHistory.createdAt))
    .limit(1);
  const match = row?.data?.match(HANDOVER_IMAGE_DATA_URL);
  if (!match) return null;
  return { mimeType: match[1]!, bytes: Buffer.from(match[2]!, 'base64') };
}

/** The recipient's document photo captured at check-in, as image bytes. */
export async function readHandoverDocument(
  tx: Pick<Tx, 'select'>,
  orgId: string,
  bookingId: string,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const [row] = await tx
    .select({
      document: sql<
        string | null
      >`${stayBookingStatusHistory.metadataJson}->'recipient'->>'document'`,
    })
    .from(stayBookingStatusHistory)
    .where(
      and(
        eq(stayBookingStatusHistory.organizationId, orgId),
        eq(stayBookingStatusHistory.bookingId, bookingId),
        eq(stayBookingStatusHistory.toStatus, 'checked_in'),
      ),
    )
    .orderBy(desc(stayBookingStatusHistory.createdAt))
    .limit(1);
  const match = row?.document?.match(DOCUMENT_DATA_URL);
  if (!match) return null;
  return { mimeType: match[1]!, bytes: Buffer.from(match[2]!, 'base64') };
}

/** Host-side read of the check-in document: booking managers of the property only. */
export async function readStayHandoverDocumentOnNeon(
  claims: SessionClaims,
  propertyId: string,
  bookingId: string,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  if (!hasPermission(claims, 'stay.booking.manage') || !claims.organizationId) return null;
  const orgId = claims.organizationId;
  const ownerPartyId = ownerPartyScope(claims);
  return withinViewerTenant(claims, async (tx) => {
    const [booking] = await tx
      .select({ id: stayBookings.id })
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
    return booking ? readHandoverDocument(tx, orgId, booking.id) : null;
  });
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
      metadata: sql<unknown>`case
        when jsonb_typeof(${stayBookingStatusHistory.metadataJson}->'photos') = 'array'
        then jsonb_set(
          ${stayBookingStatusHistory.metadataJson} #- '{recipient,document}',
          '{photos}',
          (select coalesce(jsonb_agg(photo - 'data' order by position), '[]'::jsonb)
             from jsonb_array_elements(${stayBookingStatusHistory.metadataJson}->'photos')
             with ordinality as listed(photo, position))
        )
        else ${stayBookingStatusHistory.metadataJson} #- '{recipient,document}'
      end`,
      hasDocument: sql<boolean>`(${stayBookingStatusHistory.metadataJson}->'recipient'->>'document') is not null`,
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
    const stamp = readStamp(row.metadata, row.createdAt, row.hasDocument === true);
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
  input: {
    kind: StayStampKind;
    at?: string | undefined;
    notes?: string | undefined;
    noteKeys?: string[] | undefined;
    important?: boolean | undefined;
    recipient?: StayRecipientInput | undefined;
    photos?: StayPhotoInput[] | undefined;
  },
): Promise<{ bookingStatus: string; stamp: StayStamp }> {
  if (!hasPermission(claims, 'stay.booking.manage')) fail('forbidden');
  const orgId = claims.organizationId ?? fail('organization_required');
  const ownerPartyId = ownerPartyScope(claims);
  const now = new Date();
  const at = input.at ? muscatLocalToDate(input.at) : now;
  if (Number.isNaN(at.getTime())) fail('invalid_body');
  if (at.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) fail('stay_time_in_future');
  const noteKeys = [...new Set(input.noteKeys ?? [])].filter((key) =>
    handoverNote(input.kind, key),
  );
  const notes = composeHandoverNotes(input.kind, noteKeys, input.notes);
  const recipient = input.recipient;
  if (input.kind === 'check_in') {
    if (!recipient?.document || !DOCUMENT_DATA_URL.test(recipient.document)) {
      fail('handover_document_required');
    }
    if (recipient.document.length > HANDOVER_DOCUMENT_MAX) fail('handover_document_required');
    if (!validHandoverPhone(recipient.phone)) fail('handover_phone_invalid');
    if (!handoverDocumentKind(recipient.documentKind)) fail('invalid_body');
  }
  const photoInput = input.photos ?? [];
  if (photoInput.length > HANDOVER_PHOTOS_MAX) fail('handover_photos_too_many');
  const photos = photoInput.map((photo) => {
    const match = photo.data.match(HANDOVER_IMAGE_DATA_URL);
    if (!match || photo.data.length > HANDOVER_PHOTO_MAX || !isHandoverPhotoSource(photo.source)) {
      fail('handover_photo_invalid');
    }
    const takenAt = photo.takenAt ? new Date(photo.takenAt) : null;
    return {
      source: photo.source,
      takenAt: takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt.toISOString() : null,
      sha256: createHash('sha256').update(Buffer.from(match[2]!, 'base64')).digest('hex'),
      data: photo.data,
    };
  });
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
    const handover =
      input.kind === 'check_in' && recipient
        ? {
            name: recipient.name?.trim() || null,
            phone: recipient.phone.trim(),
            documentKind: recipient.documentKind,
          }
        : null;
    const stamp: StayStamp = {
      at: at.toISOString(),
      notes,
      recordedBy: actor?.displayName ?? null,
      noteKeys,
      customNote: input.notes?.trim() || null,
      important: input.important === true,
      recipient: handover ? { ...handover, hasDocument: true } : null,
      photos: photos.map(({ source, takenAt, sha256 }, index) => ({
        index,
        source,
        takenAt,
        sha256,
      })),
    };
    const metadata = {
      at: stamp.at,
      notes,
      recordedBy: stamp.recordedBy,
      noteKeys,
      customNote: stamp.customNote,
      important: stamp.important,
      ...(photos.length ? { photos } : {}),
      ...(handover && recipient
        ? { recipient: { ...handover, document: recipient.document } }
        : {}),
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
      metadataJson: metadata,
    });
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'stay_booking',
      resourceId: booking.id,
      eventType: `stay.${toStatus}`,
      fromStatus: booking.status,
      toStatus,
      metadata: {
        referenceCode: booking.referenceCode,
        at: stamp.at,
        notes,
        important: stamp.important,
        photoCount: photos.length,
        ...(handover ? { recipientPhone: handover.phone, hasDocument: true } : {}),
      },
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
