import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import {
  createDatabase,
  organizations,
  outboxEvents,
  platformSettings,
  properties,
  stayBookings,
  stayDepositClaims,
  stayProfiles,
  stayRefunds,
  users,
  workflowEvents,
  type Database,
} from '@bhd-r/db';
import { applySessionSettings } from '@/lib/db-session-settings';
import { formatMoney } from '@/lib/format';
import { sendQueuedEmailsSoon } from '@/lib/email-outbox';
import { escapeHtml } from '@/lib/lease-booking-contract';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import { decimalToMinor } from '@/lib/property-contracts-neon';
import { publicWebOrigin } from '@/lib/seo';
import { hasAdminScope, siteAdminAccess } from '@/lib/site-admin-neon';
import type { AdminScope } from '@/lib/site-admin-shared';
import {
  CLAIM_MESSAGE_MAX,
  CLAIM_MESSAGE_MIN,
  CLAIM_NOTE_MIN,
  CLAIM_WINDOW_DAYS,
  MAX_CLAIMS_PER_STAY,
  SITE_ADMIN_LIMIT,
  claimEscalationFrom,
  claimKindLabel,
  claimsOpenFrom,
  validAdminEmail,
  whatsappDigits,
  whatsappLink,
  type ComplaintChannel,
  type DepositClaimKind,
  type DepositClaimStatus,
  type DepositClaimView,
  type SiteAdminSettings,
} from '@/lib/stay-deposit-claims';
import { openDepositNotReceivedFollowTask } from '@/lib/accounting-follow-task-neon';
import {
  actorName,
  addToDepositRefund,
  canDecideDepositRefunds,
  canPayDepositRefunds,
  currentRefund,
  guestStayUrl,
  keptOfRefund,
  lockBooking,
  queueGuestEmail,
  recordDepositEvent,
  refundDecision,
  refundDepositMinor,
  voidLastDepositTransfer,
  type RefundBooking,
} from '@/lib/stay-deposit-refund-neon';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const SETTINGS_KEY = 'site_admin_contacts';
const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const globalForDb = globalThis as unknown as { __bhdRWebDb?: { db: Database } };

function sharedDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRWebDb) {
    const { db } = createDatabase(url, { max: 3 });
    globalForDb.__bhdRWebDb = { db };
  }
  return globalForDb.__bhdRWebDb.db;
}

/** Guests (reference-code access) and the site administration act across organizations. */
async function elevated<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return sharedDb().transaction(async (tx) => {
    await applySessionSettings(tx, {
      statement_timeout: '8000',
      'app.platform_admin': 'true',
      'app.public': 'false',
    });
    return work(tx);
  });
}

function fail(code: string): never {
  throw new Error(code);
}

const iso = (value: Date | string | null | undefined): string | null =>
  !value ? null : typeof value === 'string' ? value : value.toISOString();

function cleanText(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

const claimColumns = {
  id: stayDepositClaims.id,
  bookingId: stayDepositClaims.bookingId,
  kind: stayDepositClaims.kind,
  status: stayDepositClaims.status,
  amountMinor: stayDepositClaims.amountMinor,
  currency: stayDepositClaims.currency,
  message: stayDepositClaims.message,
  createdAt: stayDepositClaims.createdAt,
  response: stayDepositClaims.response,
  responseNote: stayDepositClaims.responseNote,
  responseAmountMinor: stayDepositClaims.responseAmountMinor,
  respondedAt: stayDepositClaims.respondedAt,
  respondedByName: stayDepositClaims.respondedByName,
  escalatedAt: stayDepositClaims.escalatedAt,
  escalationMessage: stayDepositClaims.escalationMessage,
  resolution: stayDepositClaims.resolution,
  resolutionNote: stayDepositClaims.resolutionNote,
  resolutionAmountMinor: stayDepositClaims.resolutionAmountMinor,
  resolvedAt: stayDepositClaims.resolvedAt,
  resolvedByName: stayDepositClaims.resolvedByName,
};

type ClaimRow = Pick<typeof stayDepositClaims.$inferSelect, keyof typeof claimColumns>;

/** When the refund settled for the guest: the last transfer, or the rejection. */
function settledAtOf(
  refund: {
    status: string;
    transferRecordedAt: Date | null;
    approvedAt: Date | null;
  } | null,
): string | null {
  if (!refund) return null;
  if (refund.status === 'executed') return iso(refund.transferRecordedAt ?? refund.approvedAt);
  if (refund.status === 'rejected') return iso(refund.approvedAt);
  return null;
}

function toView(row: ClaimRow, settledAt: string | null): DepositClaimView {
  const status = row.status as DepositClaimStatus;
  const createdAt = iso(row.createdAt) ?? '';
  const respondedAt = iso(row.respondedAt);
  return {
    id: row.id,
    bookingId: row.bookingId,
    kind: row.kind as DepositClaimKind,
    status,
    amountMinor: row.amountMinor?.toString() ?? null,
    currency: row.currency,
    message: row.message,
    createdAt,
    response:
      row.response && respondedAt
        ? {
            decision: row.response === 'accepted' ? 'accepted' : 'rejected',
            note: row.responseNote,
            amountMinor: row.responseAmountMinor?.toString() ?? null,
            at: respondedAt,
            by: row.respondedByName,
          }
        : null,
    escalation: row.escalatedAt
      ? { at: iso(row.escalatedAt) ?? '', message: row.escalationMessage }
      : null,
    resolution:
      row.resolution && row.resolvedAt
        ? {
            outcome: row.resolution === 'guest' ? 'guest' : 'host',
            note: row.resolutionNote,
            amountMinor: row.resolutionAmountMinor?.toString() ?? null,
            at: iso(row.resolvedAt) ?? '',
            by: row.resolvedByName,
          }
        : null,
    escalateFrom: claimEscalationFrom({ status, createdAt, respondedAt }, settledAt),
  };
}

const depositRefundJoin = and(
  eq(stayRefunds.organizationId, stayBookings.organizationId),
  eq(stayRefunds.idempotencyKey, sql`'deposit:' || ${stayBookings.id}::text`),
);

/** Claims of each booking, oldest first. */
export async function loadDepositClaims(
  tx: Pick<Tx, 'select'>,
  orgId: string | null,
  bookingIds: string[],
): Promise<Map<string, DepositClaimView[]>> {
  const views = new Map<string, DepositClaimView[]>();
  if (!bookingIds.length) return views;
  const rows = await tx
    .select({
      ...claimColumns,
      refundStatus: stayRefunds.status,
      transferRecordedAt: stayRefunds.transferRecordedAt,
      approvedAt: stayRefunds.approvedAt,
    })
    .from(stayDepositClaims)
    .innerJoin(stayBookings, eq(stayBookings.id, stayDepositClaims.bookingId))
    .leftJoin(stayRefunds, depositRefundJoin)
    .where(
      and(
        inArray(stayDepositClaims.bookingId, bookingIds),
        ...(orgId ? [eq(stayDepositClaims.organizationId, orgId)] : []),
      ),
    )
    .orderBy(asc(stayDepositClaims.createdAt));
  for (const row of rows) {
    const settledAt = settledAtOf(
      row.refundStatus
        ? {
            status: row.refundStatus,
            transferRecordedAt: row.transferRecordedAt,
            approvedAt: row.approvedAt,
          }
        : null,
    );
    const list = views.get(row.bookingId) ?? [];
    list.push(toView(row, settledAt));
    views.set(row.bookingId, list);
  }
  return views;
}

async function audit(
  tx: Tx,
  booking: RefundBooking,
  actorUserId: string | null,
  eventType: string,
  metadata: Record<string, unknown>,
) {
  await tx.insert(workflowEvents).values({
    organizationId: booking.organizationId,
    actorUserId,
    resourceType: 'stay_booking',
    resourceId: booking.id,
    eventType,
    metadata: { referenceCode: booking.referenceCode, ...metadata },
  });
}

const bookingColumns = {
  id: stayBookings.id,
  organizationId: stayBookings.organizationId,
  status: stayBookings.status,
  referenceCode: stayBookings.referenceCode,
  currency: stayBookings.currency,
  stayProfileId: stayBookings.stayProfileId,
  propertyId: stayBookings.propertyId,
  unitId: stayBookings.unitId,
  guestPartyId: stayBookings.guestPartyId,
};

async function claimCounts(tx: Tx, bookingId: string) {
  const [row] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${stayDepositClaims.status} = 'open')::int`,
    })
    .from(stayDepositClaims)
    .where(eq(stayDepositClaims.bookingId, bookingId));
  return { total: row?.total ?? 0, open: row?.open ?? 0 };
}

function parseAmount(amount: string | undefined, currency: string): bigint | null {
  if (!amount?.trim()) return null;
  try {
    return decimalToMinor(amount, currency);
  } catch {
    return fail('claim_amount_invalid');
  }
}

export type GuestDepositAction =
  | { action: 'confirm_receipt' }
  | { action: 'not_received'; message?: string | undefined }
  | {
      action: 'open';
      kind: DepositClaimKind;
      amount?: string | undefined;
      message: string;
    }
  | { action: 'escalate'; claimId: string; message: string };

export type ComplaintWhatsapp = { number: string; url: string };

/**
 * The guest's side after the refund (reference-code access): confirm the transfer arrived,
 * say it did not, send the host a request or objection, or escalate one to the site
 * administration. A `not_received` answer opens a claim for the host at once.
 */
export async function guestDepositClaimAction(
  referenceCode: string,
  input: GuestDepositAction,
): Promise<{ whatsapp: ComplaintWhatsapp[] }> {
  const reference = referenceCode.trim().toUpperCase();
  return elevated(async (tx) => {
    const [booking] = await tx
      .select(bookingColumns)
      .from(stayBookings)
      .where(eq(stayBookings.referenceCode, reference))
      .limit(1);
    if (!booking) fail('booking_not_found');
    await lockBooking(tx, booking.id);
    const refund = await currentRefund(tx, booking);
    const now = new Date();

    if (input.action === 'confirm_receipt') {
      if (refund?.status !== 'executed' || refund.guestReceipt) fail('receipt_not_open');
      await tx
        .update(stayRefunds)
        .set({ guestReceipt: 'confirmed', guestReceiptAt: now, updatedAt: now })
        .where(eq(stayRefunds.id, refund.id));
      await recordDepositEvent(tx, booking, {
        event: 'receipt_confirmed',
        actorUserId: null,
        metadata: { refundId: refund.id, by: 'guest' },
        audit: { by: 'guest' },
      });
      return { whatsapp: [] };
    }

    if (input.action === 'escalate') {
      if (!UUID.test(input.claimId)) fail('claim_not_found');
      const [claim] = await tx
        .select(claimColumns)
        .from(stayDepositClaims)
        .where(
          and(eq(stayDepositClaims.id, input.claimId), eq(stayDepositClaims.bookingId, booking.id)),
        )
        .limit(1);
      if (!claim) fail('claim_not_found');
      const view = toView(claim, settledAtOf(refund));
      if (!view.escalateFrom || Date.parse(view.escalateFrom) > now.getTime()) {
        fail('escalation_not_yet');
      }
      const message = cleanText(input.message, CLAIM_MESSAGE_MAX);
      if ((message?.length ?? 0) < CLAIM_MESSAGE_MIN) fail('claim_message_required');
      await tx
        .update(stayDepositClaims)
        .set({
          status: 'escalated',
          escalatedAt: now,
          escalationMessage: message,
          updatedAt: now,
        })
        .where(eq(stayDepositClaims.id, claim.id));
      await audit(tx, booking, null, 'stay.deposit_claim.escalated', { claimId: claim.id });
      const whatsapp = await notifySiteAdmins(tx, booking, view, message!);
      return { whatsapp };
    }

    if (!refund) fail('refund_not_decided');
    const opensFrom = claimsOpenFrom({
      status: refund.status,
      requestedAt: iso(refund.requestedAt),
      paidMinor: refund.paidMinor.toString(),
    });
    if (opensFrom && Date.parse(opensFrom) > now.getTime()) fail('claim_not_yet');
    const settledAt = settledAtOf(refund);
    if (settledAt && now.getTime() - Date.parse(settledAt) > CLAIM_WINDOW_DAYS * DAY_MS) {
      fail('claim_window_closed');
    }
    const counts = await claimCounts(tx, booking.id);
    if (counts.open > 0) fail('claim_open_exists');
    if (counts.total >= MAX_CLAIMS_PER_STAY) fail('claim_limit');

    const kind: DepositClaimKind = input.action === 'not_received' ? 'not_received' : input.kind;
    const message =
      cleanText(input.message, CLAIM_MESSAGE_MAX) ??
      (kind === 'not_received' ? 'لم يصلني مبلغ التأمين المحوَّل.' : null);
    if ((message?.length ?? 0) < CLAIM_MESSAGE_MIN) fail('claim_message_required');

    let amount: bigint | null = null;
    if (kind === 'not_received') {
      if (refund.status !== 'executed' || refund.paidMinor <= 0n) {
        fail('claim_not_received_invalid');
      }
      amount = refund.paidMinor;
      if (!refund.guestReceipt || refund.guestReceipt === 'confirmed') {
        await tx
          .update(stayRefunds)
          .set({ guestReceipt: 'not_received', guestReceiptAt: now, updatedAt: now })
          .where(eq(stayRefunds.id, refund.id));
        await recordDepositEvent(tx, booking, {
          event: 'receipt_not_received',
          actorUserId: null,
          metadata: { refundId: refund.id, by: 'guest', note: message },
          audit: { by: 'guest' },
        });
      }
    } else if (input.action === 'open') {
      amount = parseAmount(input.amount, booking.currency);
      if (amount !== null) {
        if (refund.status === 'requested') fail('claim_amount_invalid');
        const deposit = await refundDepositMinor(tx, booking, refund.id);
        if (amount <= 0n || amount > keptOfRefund(refund, deposit)) fail('claim_amount_invalid');
      }
    }

    const [created] = await tx
      .insert(stayDepositClaims)
      .values({
        organizationId: booking.organizationId,
        bookingId: booking.id,
        propertyId: booking.propertyId,
        refundId: refund.id,
        kind,
        amountMinor: amount,
        currency: booking.currency,
        message: message!,
      })
      .returning({ id: stayDepositClaims.id });
    await audit(tx, booking, null, 'stay.deposit_claim.opened', {
      claimId: created!.id,
      kind,
      amountMinor: amount?.toString() ?? null,
    });
    await tx.insert(outboxEvents).values({
      organizationId: booking.organizationId,
      topic: 'stay.deposit_claim.opened',
      aggregateType: 'stay_booking',
      aggregateId: booking.id,
      payload: { referenceCode: booking.referenceCode, claimId: created!.id, kind },
    });
    if (kind === 'not_received') {
      await openDepositNotReceivedFollowTask(tx, {
        organizationId: booking.organizationId,
        bookingId: booking.id,
        claimId: created!.id,
        referenceCode: booking.referenceCode,
        guestMessage: message!,
      });
    }
    return { whatsapp: [] };
  });
}

function decisionLines(
  booking: RefundBooking,
  claim: { kind: string },
  input: { accepted: boolean; note: string; amount: bigint | null; voided: bigint | null },
  who: 'host' | 'admin' | 'accountant',
): string[] {
  const money = (minor: bigint) => formatMoney(minor.toString(), booking.currency, 'ar');
  const acceptedLine =
    who === 'accountant'
      ? 'قبِل المحاسب بلاغك وسيُراجع التحويل.'
      : who === 'host'
        ? 'قبِل المالك طلبك.'
        : 'بتّت إدارة الموقع لصالحك.';
  const rejectedLine =
    who === 'accountant'
      ? 'ردّ المحاسب على بلاغك بالرفض.'
      : who === 'host'
        ? 'لم يقبل المالك طلبك.'
        : 'بتّت إدارة الموقع لصالح المالك.';
  const noteLabel =
    who === 'accountant' ? 'رد المحاسب' : who === 'host' ? 'رد المالك' : 'قرار الإدارة';
  const lines = [
    `${claimKindLabel(claim.kind, true)}: ${input.accepted ? acceptedLine : rejectedLine}`,
    `${noteLabel}: ${input.note}`,
  ];
  if (input.voided) {
    lines.push(`سيعيد المحاسب تحويل ${money(input.voided)}، ويصلك إشعار عند التحويل.`);
  } else if (input.amount && input.amount > 0n) {
    lines.push(`يُحوَّل لك ${money(input.amount)} إضافية من التأمين، ويصلك إشعار عند التحويل.`);
  }
  return lines;
}

/** Host or accountant answers a guest's claim: accept (re-send / top-up) or decline. */
export async function respondToDepositClaimOnNeon(
  claims: SessionClaims,
  claimId: string,
  input: { decision: 'accept' | 'reject'; note: string; amount?: string | undefined },
): Promise<{ status: DepositClaimStatus }> {
  const orgId = claims.organizationId ?? fail('forbidden');
  if (!UUID.test(claimId)) fail('claim_not_found');
  const note = cleanText(input.note, CLAIM_MESSAGE_MAX);
  if ((note?.length ?? 0) < CLAIM_NOTE_MIN) fail('claim_note_required');
  const ownerPartyId = ownerPartyScope(claims);
  const hostMayDecide = canDecideDepositRefunds(claims);
  const accountantMayDecide = canPayDepositRefunds(claims);
  if (!hostMayDecide && !accountantMayDecide) fail('forbidden');

  return withinViewerTenant(claims, async (tx) => {
    const [booking] = await tx
      .select(bookingColumns)
      .from(stayDepositClaims)
      .innerJoin(stayBookings, eq(stayBookings.id, stayDepositClaims.bookingId))
      .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
      .where(
        and(
          eq(stayDepositClaims.id, claimId),
          eq(stayDepositClaims.organizationId, orgId),
          eq(stayBookings.organizationId, orgId),
          eq(properties.organizationId, orgId),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .limit(1);
    if (!booking) fail('claim_not_found');
    await lockBooking(tx, booking.id);
    const [claim] = await tx
      .select(claimColumns)
      .from(stayDepositClaims)
      .where(eq(stayDepositClaims.id, claimId))
      .limit(1);
    if (claim?.status !== 'open') fail('claim_closed');
    if (!hostMayDecide && claim.kind !== 'not_received') fail('forbidden');

    const accepted = input.decision === 'accept';
    const by = await actorName(tx, claims.sub);
    const who: 'host' | 'admin' | 'accountant' =
      accountantMayDecide && !hostMayDecide ? 'accountant' : 'host';
    const meta = { claimId, note, by, actorUserId: claims.sub };
    let amount: bigint | null = null;
    let voided: bigint | null = null;
    if (accepted) {
      if (claim.kind === 'not_received') {
        voided = await voidLastDepositTransfer(tx, booking, meta);
      } else {
        amount = parseAmount(input.amount, booking.currency) ?? claim.amountMinor ?? null;
        if (amount !== null && amount > 0n) await addToDepositRefund(tx, booking, amount, meta);
      }
    }
    const now = new Date();
    const status: DepositClaimStatus = accepted ? 'accepted' : 'rejected';
    await tx
      .update(stayDepositClaims)
      .set({
        status,
        response: accepted ? 'accepted' : 'rejected',
        responseNote: note,
        responseAmountMinor: voided ?? amount,
        respondedAt: now,
        respondedByUserId: claims.sub,
        respondedByName: by,
        updatedAt: now,
      })
      .where(eq(stayDepositClaims.id, claimId));
    await audit(tx, booking, claims.sub, `stay.deposit_claim.${status}`, {
      claimId,
      amountMinor: (voided ?? amount)?.toString() ?? null,
    });
    await queueGuestEmail(tx, booking, {
      subject:
        who === 'admin'
          ? `رد المحاسب على بلاغ التأمين — ${booking.referenceCode}`
          : `رد المالك على طلبك بشأن التأمين — ${booking.referenceCode}`,
      body: [
        ...decisionLines(booking, claim, { accepted, note: note!, amount, voided }, who),
        'إن لم يكن الرد مرضياً، يمكنك رفع شكوى لإدارة الموقع من صفحة إقامتك بعد 3 أيام عمل من استرداد التأمين.',
      ],
    });
    return { status };
  });
}

function readSettings(value: unknown): SiteAdminSettings {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const list = (input: unknown) =>
    Array.isArray(input)
      ? input.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      : [];
  return {
    channel: row.channel === 'whatsapp' ? 'whatsapp' : 'email',
    emails: list(row.emails).map((email) => email.trim().toLowerCase()),
    whatsapp: list(row.whatsapp).map((number) => number.trim()),
  };
}

async function loadSettings(tx: Pick<Tx, 'select'>): Promise<SiteAdminSettings> {
  const [row] = await tx
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, SETTINGS_KEY))
    .limit(1);
  return readSettings(row?.value);
}

/** Tells the site administration about a new complaint by email, or hands WhatsApp links back. */
async function notifySiteAdmins(
  tx: Tx,
  booking: RefundBooking & { propertyId: string },
  claim: DepositClaimView,
  escalation: string,
): Promise<ComplaintWhatsapp[]> {
  const settings = await loadSettings(tx);
  const [facts] = await tx
    .select({
      propertyAr: properties.nameAr,
      organizationAr: organizations.displayNameAr,
      guest: sql<
        string | null
      >`${stayBookings.pricingSnapshotJson}->'guestContact'->>'displayName'`,
    })
    .from(stayBookings)
    .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
    .innerJoin(organizations, eq(organizations.id, stayBookings.organizationId))
    .where(eq(stayBookings.id, booking.id))
    .limit(1);
  const money = (minor: string | null) =>
    minor ? formatMoney(minor, booking.currency, 'ar') : null;
  const lines = [
    `الحجز: ${booking.referenceCode} · ${facts?.propertyAr ?? ''} · ${facts?.organizationAr ?? ''}`,
    `الضيف: ${facts?.guest ?? '—'}`,
    `نوع الطلب: ${claimKindLabel(claim.kind, true)}${
      money(claim.amountMinor) ? ` · المبلغ: ${money(claim.amountMinor)}` : ''
    }`,
    `طلب الضيف للمالك: ${claim.message}`,
    claim.response
      ? `رد المالك: ${claim.response.decision === 'accepted' ? 'قبول' : 'رفض'} — ${claim.response.note ?? ''}`
      : 'لم يرد المالك بعد.',
    `الشكوى: ${escalation}`,
  ];
  const adminUrl = `${publicWebOrigin()}/ar/site-admin/complaints`;
  if (settings.channel === 'whatsapp') {
    const text = [
      `شكوى تأمين جديدة — ${booking.referenceCode}`,
      ...lines,
      guestStayUrl(booking),
    ].join('\n');
    return settings.whatsapp.flatMap((number) => {
      const url = whatsappLink(number, text);
      return url ? [{ number, url }] : [];
    });
  }
  for (const email of settings.emails) {
    await tx.insert(outboxEvents).values({
      organizationId: booking.organizationId,
      topic: 'notification.delivery.requested',
      aggregateType: 'stay_booking',
      aggregateId: booking.id,
      payload: {
        correlationId: randomUUID(),
        organizationId: booking.organizationId,
        notificationId: randomUUID(),
        channel: 'email',
        recipient: email,
        subject: `شكوى تأمين جديدة — ${booking.referenceCode}`,
        text: [...lines, '', `للبتّ في الشكوى: ${adminUrl}`, '', 'BHD R'].join('\n'),
        html: `<div dir="rtl">${lines
          .map((line) => `<p>${escapeHtml(line)}</p>`)
          .join(
            '',
          )}<p><a href="${escapeHtml(adminUrl)}">افتح شكاوى التأمين</a></p><p>BHD R</p></div>`,
      },
    });
  }
  if (settings.emails.length) sendQueuedEmailsSoon();
  return [];
}

/** WhatsApp links for an escalated complaint, when the site administration uses WhatsApp. */
export async function loadComplaintWhatsapp(
  referenceCode: string,
  claim: DepositClaimView,
): Promise<ComplaintWhatsapp[]> {
  return elevated(async (tx) => {
    const settings = await loadSettings(tx);
    if (settings.channel !== 'whatsapp') return [];
    const text = [
      `شكوى بشأن تأمين الحجز ${referenceCode}`,
      `نوع الطلب: ${claimKindLabel(claim.kind, true)}`,
      claim.escalation?.message ?? claim.message,
    ].join('\n');
    return settings.whatsapp.flatMap((number) => {
      const url = whatsappLink(number, text);
      return url ? [{ number, url }] : [];
    });
  });
}

/**
 * Site administration: platform administrators and the complaint-inbox emails hold every scope;
 * delegates hold the scopes they were granted.
 */
export async function isSiteAdmin(
  claims: SessionClaims,
  scope: AdminScope = 'complaints',
): Promise<boolean> {
  return hasAdminScope(claims, scope);
}

export async function loadSiteAdminSettings(claims: SessionClaims): Promise<SiteAdminSettings> {
  if (!(await isSiteAdmin(claims))) fail('forbidden');
  return elevated((tx) => loadSettings(tx));
}

/** The inbox emails are the top-level administrators, so only they may change the list. */
export async function saveSiteAdminSettings(
  claims: SessionClaims,
  input: { channel: ComplaintChannel; emails: string[]; whatsapp: string[] },
): Promise<SiteAdminSettings> {
  if (!(await siteAdminAccess(claims))?.root) fail('forbidden');
  const emails = [...new Set(input.emails.map((email) => email.trim().toLowerCase()))].filter(
    Boolean,
  );
  const whatsapp = [...new Set(input.whatsapp.map((number) => number.trim()))].filter(Boolean);
  if (
    !emails.length ||
    emails.length > SITE_ADMIN_LIMIT ||
    whatsapp.length > SITE_ADMIN_LIMIT ||
    !emails.every(validAdminEmail) ||
    !whatsapp.every((number) => whatsappDigits(number) !== null) ||
    (input.channel === 'whatsapp' && !whatsapp.length)
  ) {
    fail('settings_invalid');
  }
  const value: SiteAdminSettings = { channel: input.channel, emails, whatsapp };
  await elevated(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: SETTINGS_KEY, value, updatedByUserId: claims.sub })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value, updatedAt: new Date(), updatedByUserId: claims.sub },
      });
  });
  return value;
}

export type DepositComplaint = DepositClaimView & {
  reference: string;
  propertyName: string;
  propertyNameEn: string | null;
  organizationName: string;
  guestName: string | null;
  guestEmail: string | null;
  depositMinor: string | null;
  refundStatus: string | null;
  refundAmountMinor: string | null;
  paidMinor: string | null;
  decisionNote: string | null;
  guestPageUrl: string;
};

/** Escalated complaints across all organizations, awaiting ones first. */
export async function listDepositComplaints(claims: SessionClaims): Promise<DepositComplaint[]> {
  if (!(await isSiteAdmin(claims))) fail('forbidden');
  return elevated(async (tx) => {
    const rows = await tx
      .select({
        ...claimColumns,
        reference: stayBookings.referenceCode,
        organizationId: stayBookings.organizationId,
        bookingStatus: stayBookings.status,
        stayProfileId: stayBookings.stayProfileId,
        propertyId: stayBookings.propertyId,
        unitId: stayBookings.unitId,
        guestPartyId: stayBookings.guestPartyId,
        propertyAr: properties.nameAr,
        propertyEn: properties.nameEn,
        organizationAr: organizations.displayNameAr,
        guestName: sql<
          string | null
        >`${stayBookings.pricingSnapshotJson}->'guestContact'->>'displayName'`,
        guestEmail: sql<
          string | null
        >`coalesce(${stayBookings.pricingSnapshotJson}->'guestContact'->>'email', ${users.email})`,
        profileDeposit: stayProfiles.depositMinor,
        refundId: stayRefunds.id,
        refundStatus: stayRefunds.status,
        refundAmount: stayRefunds.amountMinor,
        paidMinor: stayRefunds.paidMinor,
        transferRecordedAt: stayRefunds.transferRecordedAt,
        approvedAt: stayRefunds.approvedAt,
      })
      .from(stayDepositClaims)
      .innerJoin(stayBookings, eq(stayBookings.id, stayDepositClaims.bookingId))
      .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
      .innerJoin(organizations, eq(organizations.id, stayBookings.organizationId))
      .leftJoin(stayProfiles, eq(stayProfiles.id, stayBookings.stayProfileId))
      .leftJoin(users, eq(users.id, stayBookings.userId))
      .leftJoin(stayRefunds, depositRefundJoin)
      .where(isNotNull(stayDepositClaims.escalatedAt))
      .orderBy(
        sql`case when ${stayDepositClaims.status} = 'escalated' then 0 else 1 end`,
        desc(stayDepositClaims.escalatedAt),
      )
      .limit(200);
    const complaints: DepositComplaint[] = [];
    for (const row of rows) {
      const booking: RefundBooking = {
        id: row.bookingId,
        organizationId: row.organizationId,
        status: row.bookingStatus,
        referenceCode: row.reference,
        currency: row.currency,
        stayProfileId: row.stayProfileId,
        propertyId: row.propertyId,
        unitId: row.unitId,
        guestPartyId: row.guestPartyId,
      };
      const decision = row.refundId ? await refundDecision(tx, booking, row.refundId) : null;
      const settledAt = settledAtOf(
        row.refundStatus
          ? {
              status: row.refundStatus,
              transferRecordedAt: row.transferRecordedAt,
              approvedAt: row.approvedAt,
            }
          : null,
      );
      complaints.push({
        ...toView(row, settledAt),
        reference: row.reference,
        propertyName: row.propertyAr,
        propertyNameEn: row.propertyEn,
        organizationName: row.organizationAr,
        guestName: row.guestName,
        guestEmail: row.guestEmail,
        depositMinor: (decision?.depositMinor ?? row.profileDeposit)?.toString() ?? null,
        refundStatus: row.refundStatus,
        refundAmountMinor: row.refundAmount?.toString() ?? null,
        paidMinor: row.paidMinor?.toString() ?? null,
        decisionNote: decision?.note ?? null,
        guestPageUrl: guestStayUrl(booking),
      });
    }
    return complaints;
  });
}

export type DepositClaimQueueRow = {
  claimId: string;
  bookingId: string;
  reference: string;
  propertyId: string;
  propertyNameAr: string;
  propertyNameEn: string | null;
  party: string | null;
  since: string;
};

function queueColumns(
  since: typeof stayDepositClaims.createdAt | typeof stayDepositClaims.escalatedAt,
) {
  return {
    claimId: stayDepositClaims.id,
    bookingId: stayDepositClaims.bookingId,
    reference: stayBookings.referenceCode,
    propertyId: properties.id,
    propertyNameAr: properties.nameAr,
    propertyNameEn: properties.nameEn,
    party: sql<string | null>`${stayBookings.pricingSnapshotJson}->'guestContact'->>'displayName'`,
    since,
  };
}

/** Guest claims waiting for the host's answer (for the bell), oldest first. */
export async function loadOpenClaimQueue(
  tx: Pick<Tx, 'select'>,
  orgId: string,
  scope: { ownerPartyId: string | null; limit: number },
): Promise<DepositClaimQueueRow[]> {
  const rows = await tx
    .select(queueColumns(stayDepositClaims.createdAt))
    .from(stayDepositClaims)
    .innerJoin(stayBookings, eq(stayBookings.id, stayDepositClaims.bookingId))
    .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
    .where(
      and(
        eq(stayDepositClaims.organizationId, orgId),
        eq(stayDepositClaims.status, 'open'),
        eq(properties.organizationId, orgId),
        ...(scope.ownerPartyId ? [eq(properties.ownerPartyId, scope.ownerPartyId)] : []),
      ),
    )
    .orderBy(asc(stayDepositClaims.createdAt))
    .limit(scope.limit);
  return rows.map((row) => ({ ...row, since: iso(row.since) ?? '' }));
}

/** Escalated complaints still awaiting the site administration (for the bell). */
export async function loadOpenComplaintQueue(
  claims: SessionClaims,
  limit: number,
): Promise<DepositClaimQueueRow[]> {
  if (!(await isSiteAdmin(claims))) return [];
  return elevated(async (tx) => {
    const rows = await tx
      .select(queueColumns(stayDepositClaims.escalatedAt))
      .from(stayDepositClaims)
      .innerJoin(stayBookings, eq(stayBookings.id, stayDepositClaims.bookingId))
      .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
      .where(eq(stayDepositClaims.status, 'escalated'))
      .orderBy(asc(stayDepositClaims.escalatedAt))
      .limit(limit);
    return rows.map((row) => ({ ...row, since: iso(row.since) ?? '' }));
  });
}

/** The site administration decides a complaint, for the guest (with money back) or the host. */
export async function resolveDepositComplaint(
  claims: SessionClaims,
  claimId: string,
  input: { outcome: 'guest' | 'host'; note: string; amount?: string | undefined },
): Promise<{ status: DepositClaimStatus }> {
  if (!(await isSiteAdmin(claims))) fail('forbidden');
  if (!UUID.test(claimId)) fail('claim_not_found');
  const note = cleanText(input.note, CLAIM_MESSAGE_MAX);
  if ((note?.length ?? 0) < CLAIM_NOTE_MIN) fail('claim_note_required');
  return elevated(async (tx) => {
    const [found] = await tx
      .select(bookingColumns)
      .from(stayDepositClaims)
      .innerJoin(stayBookings, eq(stayBookings.id, stayDepositClaims.bookingId))
      .where(eq(stayDepositClaims.id, claimId))
      .limit(1);
    if (!found) fail('claim_not_found');
    await lockBooking(tx, found.id);
    const [claim] = await tx
      .select(claimColumns)
      .from(stayDepositClaims)
      .where(eq(stayDepositClaims.id, claimId))
      .limit(1);
    if (claim?.status !== 'escalated') fail('complaint_not_open');
    const forGuest = input.outcome === 'guest';
    const [admin] = await tx
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    const by = admin?.name ?? null;
    const meta = {
      claimId,
      note,
      by: by ? `إدارة الموقع · ${by}` : 'إدارة الموقع',
      actorUserId: claims.sub,
    };
    let amount: bigint | null = null;
    let voided: bigint | null = null;
    if (forGuest) {
      const refund = await currentRefund(tx, found);
      if (claim.kind === 'not_received' && refund?.status === 'executed') {
        voided = await voidLastDepositTransfer(tx, found, meta);
      } else {
        amount = parseAmount(input.amount, found.currency);
        if (amount !== null && amount > 0n) await addToDepositRefund(tx, found, amount, meta);
      }
    }
    const now = new Date();
    await tx
      .update(stayDepositClaims)
      .set({
        status: 'resolved',
        resolution: input.outcome,
        resolutionNote: note,
        resolutionAmountMinor: voided ?? amount,
        resolvedAt: now,
        resolvedByUserId: claims.sub,
        resolvedByName: meta.by,
        updatedAt: now,
      })
      .where(eq(stayDepositClaims.id, claimId));
    await audit(tx, found, claims.sub, 'stay.deposit_claim.resolved', {
      claimId,
      outcome: input.outcome,
      amountMinor: (voided ?? amount)?.toString() ?? null,
    });
    await queueGuestEmail(tx, found, {
      subject: `قرار إدارة الموقع في شكواك — ${found.referenceCode}`,
      body: decisionLines(
        found,
        claim,
        { accepted: forGuest, note: note!, amount, voided },
        'admin',
      ),
    });
    return { status: 'resolved' as const };
  });
}

/**
 * The host's review of the guest goes to the guest at once: emailed, and shown on their stay
 * page. (The guest's own review stays hidden from the host until the deposit is settled.)
 */
export async function notifyGuestOfHostReview(
  bookingId: string,
  review: { score: number; summary: string | null },
): Promise<void> {
  await elevated(async (tx) => {
    const [booking] = await tx
      .select(bookingColumns)
      .from(stayBookings)
      .where(eq(stayBookings.id, bookingId))
      .limit(1);
    if (!booking) return;
    await queueGuestEmail(tx, booking, {
      subject: `قيّمك المالك بعد إقامتك — ${booking.referenceCode}`,
      body: [
        `تقييم المالك لك: ${review.score.toFixed(1)} من 10.`,
        ...(review.summary ? [review.summary] : []),
        'تجد التقييم كاملاً في صفحة إقامتك.',
      ],
    });
  });
}
