import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  outboxEvents,
  properties,
  stayBookingStatusHistory,
  stayBookings,
  stayProfiles,
  stayRefunds,
  units,
  users,
  workflowEvents,
  type Database,
} from '@bhd-r/db';
import { assertStayBookingTransition } from '@bhd-r/domain';
import { hasBookingReview } from '@/lib/booking-reviews-neon';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import { formatMoney } from '@/lib/format';
import { escapeHtml } from '@/lib/lease-booking-contract';
import { decimalToMinor } from '@/lib/property-contracts-neon';
import { publicWebOrigin } from '@/lib/seo';
import { muscatLocalToDate } from '@/lib/stay-arrival-neon';
import {
  depositReceiptNumbers,
  REFUND_CONSENT_VERSION,
  REFUND_NOTE_MAX,
  REFUND_RECEIPT_DATA_URL,
  REFUND_RECEIPT_MAX,
  isRefundPayoutMethod,
  maskAccount,
  validPayoutAccount,
  type DepositRefundStatus,
  type DepositRefundView,
  type RefundPayout,
  type RefundPayoutMethod,
  type RefundRequestPayout,
  type RefundTransfer,
} from '@/lib/stay-deposit-refund';
import { validHandoverPhone } from '@/lib/stay-handover';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Status-history marker for refund events; never a booking status. */
const HISTORY_STATUS = 'deposit_refund';
const FUTURE_TOLERANCE_MS = 15 * 60_000;

const refundKey = (bookingId: string) => `deposit:${bookingId}`;

function fail(code: string): never {
  throw new Error(code);
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const iso = (value: Date | string | null | undefined): string | null =>
  !value ? null : typeof value === 'string' ? value : value.toISOString();

function readPayout(value: unknown): RefundPayout | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const account = text(row.account);
  if (!isRefundPayoutMethod(row.method) || !account) return null;
  return { method: row.method, account, bank: text(row.bank), holder: text(row.holder) };
}

function readRequestPayout(value: unknown): RefundRequestPayout | null {
  const payout = readPayout(value);
  if (!payout) return null;
  return { ...payout, phone: text((value as Record<string, unknown>).phone) };
}

function cleanNote(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, REFUND_NOTE_MAX) : null;
}

/** Profile deposit of each booking (the booking total never includes it). */
export async function loadBookingDeposits(
  tx: Pick<Tx, 'select'>,
  orgId: string,
  bookingIds: string[],
): Promise<Map<string, string>> {
  const deposits = new Map<string, string>();
  if (!bookingIds.length) return deposits;
  const rows = await tx
    .select({ bookingId: stayBookings.id, depositMinor: stayProfiles.depositMinor })
    .from(stayBookings)
    .innerJoin(stayProfiles, eq(stayProfiles.id, stayBookings.stayProfileId))
    .where(and(eq(stayBookings.organizationId, orgId), inArray(stayBookings.id, bookingIds)));
  for (const row of rows) {
    if (row.depositMinor && row.depositMinor > 0n) {
      deposits.set(row.bookingId, row.depositMinor.toString());
    }
  }
  return deposits;
}

/** Deposit refund of each booking, with the guest's request, the decision and the transfer. */
export async function loadDepositRefunds(
  tx: Pick<Tx, 'select'>,
  orgId: string,
  bookingIds: string[],
): Promise<Map<string, DepositRefundView>> {
  const views = new Map<string, DepositRefundView>();
  if (!bookingIds.length) return views;
  const [refunds, events] = await Promise.all([
    tx
      .select({
        id: stayRefunds.id,
        bookingId: stayRefunds.bookingId,
        status: stayRefunds.status,
        amountMinor: stayRefunds.amountMinor,
        currency: stayRefunds.currency,
        reason: stayRefunds.reason,
        approvedAt: stayRefunds.approvedAt,
        createdAt: stayRefunds.createdAt,
        paidMinor: stayRefunds.paidMinor,
        transferRecordedAt: stayRefunds.transferRecordedAt,
        guestReceipt: stayRefunds.guestReceipt,
        guestReceiptAt: stayRefunds.guestReceiptAt,
      })
      .from(stayRefunds)
      .where(
        and(
          eq(stayRefunds.organizationId, orgId),
          inArray(stayRefunds.bookingId, bookingIds),
          sql`${stayRefunds.idempotencyKey} like 'deposit:%'`,
        ),
      )
      .orderBy(asc(stayRefunds.createdAt)),
    tx
      .select({
        metadata: sql<unknown>`${stayBookingStatusHistory.metadataJson} #- '{receipt}'`,
        hasReceipt: sql<boolean>`(${stayBookingStatusHistory.metadataJson}->>'receipt') is not null`,
      })
      .from(stayBookingStatusHistory)
      .where(
        and(
          eq(stayBookingStatusHistory.organizationId, orgId),
          inArray(stayBookingStatusHistory.bookingId, bookingIds),
          eq(stayBookingStatusHistory.toStatus, HISTORY_STATUS),
        ),
      )
      .orderBy(asc(stayBookingStatusHistory.createdAt)),
  ]);

  const byRefund = new Map<string, Array<{ meta: Record<string, unknown>; receipt: boolean }>>();
  for (const event of events) {
    const meta =
      event.metadata && typeof event.metadata === 'object'
        ? (event.metadata as Record<string, unknown>)
        : {};
    const refundId = text(meta.refundId);
    if (!refundId) continue;
    const list = byRefund.get(refundId) ?? [];
    list.push({ meta, receipt: event.hasReceipt === true });
    byRefund.set(refundId, list);
  }

  for (const refund of refunds) {
    const view: DepositRefundView = {
      id: refund.id,
      status: refund.status as DepositRefundStatus,
      amountMinor: refund.amountMinor.toString(),
      currency: refund.currency,
      requestedAt: iso(refund.createdAt) ?? '',
      requestedBy: 'host',
      consent: null,
      guestNote: null,
      guestPayout: null,
      decidedAt: iso(refund.approvedAt),
      decidedBy: null,
      decisionNote: null,
      transfer: null,
      settledDepositMinor: null,
      paidMinor: refund.paidMinor.toString(),
      transferRecordedAt: iso(refund.transferRecordedAt),
      guestReceipt:
        refund.guestReceipt === 'confirmed' || refund.guestReceipt === 'not_received'
          ? refund.guestReceipt
          : null,
      guestReceiptAt: iso(refund.guestReceiptAt),
    };
    for (const { meta, receipt } of byRefund.get(refund.id) ?? []) {
      const settledDeposit = text(meta.depositMinor);
      if (settledDeposit && /^\d+$/.test(settledDeposit)) view.settledDepositMinor = settledDeposit;
      if (meta.event === 'requested') {
        view.requestedBy = meta.by === 'guest' ? 'guest' : 'host';
        view.guestNote = text(meta.note);
        view.guestPayout = readRequestPayout(meta.payout);
        const consent =
          meta.consent && typeof meta.consent === 'object'
            ? (meta.consent as Record<string, unknown>)
            : {};
        const version = text(consent.version);
        const acceptedAt = text(consent.acceptedAt);
        view.consent = version && acceptedAt ? { version, acceptedAt } : null;
      } else if (meta.event === 'approved' || meta.event === 'rejected') {
        view.decidedBy = text(meta.decidedBy);
        view.decisionNote = text(meta.note);
      } else if (meta.event === 'paid') {
        const payout = readPayout(meta.transfer);
        const transfer =
          meta.transfer && typeof meta.transfer === 'object'
            ? (meta.transfer as Record<string, unknown>)
            : {};
        if (payout) {
          view.transfer = {
            ...payout,
            at: text(transfer.at) ?? '',
            reference: text(transfer.reference),
            recordedBy: text(transfer.recordedBy),
            note: text(transfer.note),
            hasReceipt: receipt,
            amountMinor: text(meta.amountMinor),
          };
        }
      } else if (meta.event === 'transfer_voided') {
        view.transfer = null;
      }
    }
    views.set(refund.bookingId, view);
  }
  return views;
}

export type RefundBooking = {
  id: string;
  organizationId: string;
  status: string;
  referenceCode: string;
  currency: string;
  stayProfileId: string;
};

export async function lockBooking(tx: Tx, bookingId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${bookingId}, 29))`);
}

export async function currentRefund(tx: Tx, booking: RefundBooking) {
  const [row] = await tx
    .select({
      id: stayRefunds.id,
      status: stayRefunds.status,
      amountMinor: stayRefunds.amountMinor,
      paidMinor: stayRefunds.paidMinor,
      requestedAt: stayRefunds.createdAt,
      approvedAt: stayRefunds.approvedAt,
      transferRecordedAt: stayRefunds.transferRecordedAt,
      guestReceipt: stayRefunds.guestReceipt,
    })
    .from(stayRefunds)
    .where(
      and(
        eq(stayRefunds.organizationId, booking.organizationId),
        eq(stayRefunds.idempotencyKey, refundKey(booking.id)),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function depositOf(tx: Tx, booking: RefundBooking): Promise<bigint> {
  const [profile] = await tx
    .select({ depositMinor: stayProfiles.depositMinor })
    .from(stayProfiles)
    .where(
      and(
        eq(stayProfiles.id, booking.stayProfileId),
        eq(stayProfiles.organizationId, booking.organizationId),
      ),
    )
    .limit(1);
  return profile?.depositMinor ?? 0n;
}

export type DepositRefundEvent =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'paid'
  | 'adjusted'
  | 'transfer_voided'
  | 'receipt_confirmed'
  | 'receipt_not_received';

export async function recordDepositEvent(
  tx: Tx,
  booking: RefundBooking,
  input: {
    event: DepositRefundEvent;
    actorUserId: string | null;
    metadata: Record<string, unknown>;
    audit: Record<string, unknown>;
  },
) {
  await tx.insert(stayBookingStatusHistory).values({
    organizationId: booking.organizationId,
    bookingId: booking.id,
    fromStatus: booking.status,
    toStatus: HISTORY_STATUS,
    actorUserId: input.actorUserId,
    reason: `deposit_refund_${input.event}`,
    metadataJson: { event: input.event, ...input.metadata },
  });
  await tx.insert(workflowEvents).values({
    organizationId: booking.organizationId,
    actorUserId: input.actorUserId,
    resourceType: 'stay_booking',
    resourceId: booking.id,
    eventType: `stay.deposit_refund.${input.event}`,
    metadata: { referenceCode: booking.referenceCode, ...input.audit },
  });
  await tx.insert(outboxEvents).values({
    organizationId: booking.organizationId,
    topic: `stay.deposit_refund.${input.event}`,
    aggregateType: 'stay_booking',
    aggregateId: booking.id,
    payload: { referenceCode: booking.referenceCode, ...input.audit },
  });
}

/**
 * Emails the guest about a host step (approval, rejection, transfer) through the outbox
 * worker. The guest page shows the same notice live; this is the copy that reaches them
 * away from it. Guests without an email on the booking or account get the page only.
 */
async function queueGuestRefundNotice(
  tx: Tx,
  booking: RefundBooking,
  notice:
    | { event: 'approved'; amountMinor: bigint; note: string | null }
    | { event: 'rejected'; note: string | null }
    | {
        event: 'paid';
        amountMinor: bigint;
        paidTo: string;
        at: Date;
        depositMinor: bigint;
        retainedMinor: bigint;
        note: string | null;
        transferNote: string | null;
      },
) {
  const money = (minor: bigint) => formatMoney(minor.toString(), booking.currency, 'ar');
  const lines =
    notice.event === 'approved'
      ? {
          subject: `تمت الموافقة على استرداد التأمين — ${booking.referenceCode}`,
          body: [
            `وافق المالك على استرداد ${money(notice.amountMinor)} من مبلغ التأمين.`,
            'الطلب الآن لدى المحاسب لتحويل المبلغ، وسيصلك إشعار عند التحويل.',
            ...(notice.note ? [`ملاحظة المالك: ${notice.note}`] : []),
          ],
        }
      : notice.event === 'rejected'
        ? {
            subject: `رُفض طلب استرداد التأمين — ${booking.referenceCode}`,
            body: [
              'لم يوافق المالك على استرداد مبلغ التأمين.',
              ...(notice.note ? [`سبب الرفض: ${notice.note}`] : []),
            ],
          }
        : {
            subject: `تم تحويل مبلغ التأمين — ${booking.referenceCode}`,
            body: [
              `حُوّل ${money(notice.amountMinor)} إلى ${notice.paidTo}.`,
              `تاريخ التحويل: ${new Intl.DateTimeFormat('ar-OM', {
                dateStyle: 'long',
                timeStyle: 'short',
                timeZone: 'Asia/Muscat',
              }).format(notice.at)}`,
              ...(notice.retainedMinor > 0n
                ? [
                    `مبلغ التأمين ${money(notice.depositMinor)}، خُصم منه ${money(notice.retainedMinor)}${
                      notice.note ? `: ${notice.note}` : '.'
                    }`,
                  ]
                : []),
              ...(notice.transferNote ? [`ملاحظة التحويل: ${notice.transferNote}`] : []),
              'أكّد استلام المبلغ من صفحة إقامتك خلال 24 ساعة، أو أخبرنا إن لم يصلك. دون رد خلال 24 ساعة يُعتبر المبلغ مستلماً.',
            ],
          };
  await queueGuestEmail(tx, booking, lines);
}

/**
 * Emails the guest through the outbox worker, with a link to their stay page. Guests without
 * an email on the booking or their account get the page only.
 */
export async function queueGuestEmail(
  tx: Tx,
  booking: RefundBooking,
  lines: { subject: string; body: string[] },
) {
  const [row] = await tx
    .select({
      bookingId: stayBookings.id,
      snapshot: stayBookings.pricingSnapshotJson,
      accountEmail: users.email,
    })
    .from(stayBookings)
    .leftJoin(users, eq(users.id, stayBookings.userId))
    .where(
      and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, booking.organizationId)),
    )
    .limit(1);
  if (!row) return;
  const contact =
    row.snapshot.guestContact && typeof row.snapshot.guestContact === 'object'
      ? (row.snapshot.guestContact as Record<string, unknown>)
      : {};
  const email = [text(contact.email), text(row.accountEmail)].find((value) => value?.includes('@'));
  if (!email) return;
  const name = text(contact.displayName);
  const pageUrl = guestStayUrl(booking);
  const greeting = name ? `مرحباً ${name}،` : 'مرحباً،';
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
      recipient: email.toLowerCase(),
      subject: lines.subject,
      text: [greeting, '', ...lines.body, '', `صفحة إقامتك: ${pageUrl}`, '', 'BHD R'].join('\n'),
      html: `<div dir="rtl"><p>${escapeHtml(greeting)}</p>${lines.body
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')}<p><a href="${escapeHtml(pageUrl)}">افتح صفحة إقامتك</a></p><p>BHD R</p></div>`,
    },
  });
}

export function guestStayUrl(booking: Pick<RefundBooking, 'id' | 'referenceCode'>): string {
  return `${publicWebOrigin()}/ar/guest/stays/${booking.id}?ref=${encodeURIComponent(booking.referenceCode)}`;
}

/** The refund settles the stay: checked_out → closed. */
async function closeBooking(
  tx: Tx,
  booking: RefundBooking,
  actorUserId: string | null,
  reason: string,
) {
  if (!assertStayBookingTransition(booking.status, 'closed').ok) return booking.status;
  await tx
    .update(stayBookings)
    .set({ status: 'closed', updatedAt: new Date() })
    .where(
      and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, booking.organizationId)),
    );
  await tx.insert(stayBookingStatusHistory).values({
    organizationId: booking.organizationId,
    bookingId: booking.id,
    fromStatus: booking.status,
    toStatus: 'closed',
    actorUserId,
    reason,
  });
  return 'closed';
}

/**
 * Guest asks for the deposit back (reference-code access, already inside the caller's
 * transaction). Repeating the request returns the existing one.
 */
export async function insertGuestDepositRefundRequest(
  tx: Tx,
  booking: RefundBooking,
  input: { note?: string | undefined; payout: RefundRequestPayout },
): Promise<void> {
  await lockBooking(tx, booking.id);
  if (await currentRefund(tx, booking)) return;
  if (booking.status !== 'checked_out') fail('refund_not_open');
  if (!(await hasBookingReview(tx, booking.id, 'guest_to_host'))) fail('review_required');
  const deposit = await depositOf(tx, booking);
  if (deposit <= 0n) fail('refund_no_deposit');
  const payout = input.payout;
  if (!validPayoutAccount('bank', payout.account)) fail('refund_account_invalid');
  if ((payout.bank?.trim().length ?? 0) < 2) fail('refund_bank_required');
  if (!payout.phone || !validHandoverPhone(payout.phone.trim())) fail('refund_phone_invalid');
  const note = cleanNote(input.note);
  const [refund] = await tx
    .insert(stayRefunds)
    .values({
      organizationId: booking.organizationId,
      bookingId: booking.id,
      status: 'requested',
      amountMinor: deposit,
      currency: booking.currency,
      reason: note,
      idempotencyKey: refundKey(booking.id),
    })
    .returning({ id: stayRefunds.id });
  await recordDepositEvent(tx, booking, {
    event: 'requested',
    actorUserId: null,
    metadata: {
      refundId: refund!.id,
      by: 'guest',
      consent: { version: REFUND_CONSENT_VERSION, acceptedAt: new Date().toISOString() },
      note,
      payout: {
        method: payout.method,
        account: payout.account.trim(),
        bank: payout.bank?.trim() || null,
        holder: payout.holder?.trim() || null,
        phone: payout.phone.trim(),
      },
    },
    audit: { amountMinor: deposit.toString(), by: 'guest' },
  });
}

async function loadHostBooking(
  tx: Tx,
  claims: SessionClaims,
  propertyId: string,
  bookingId: string,
): Promise<RefundBooking> {
  const orgId = claims.organizationId ?? fail('organization_required');
  const ownerPartyId = ownerPartyScope(claims);
  await lockBooking(tx, bookingId);
  const [booking] = await tx
    .select({
      id: stayBookings.id,
      organizationId: stayBookings.organizationId,
      status: stayBookings.status,
      referenceCode: stayBookings.referenceCode,
      currency: stayBookings.currency,
      stayProfileId: stayBookings.stayProfileId,
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
  return booking ?? fail('booking_not_found');
}

export async function actorName(tx: Tx, userId: string): Promise<string | null> {
  const [actor] = await tx
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return actor?.displayName ?? null;
}

export function canDecideDepositRefunds(claims: SessionClaims): boolean {
  return (
    hasPermission(claims, 'stay.booking.manage') || hasPermission(claims, 'stay.refund.approve')
  );
}

export function canPayDepositRefunds(claims: SessionClaims): boolean {
  return hasPermission(claims, 'payment.refund');
}

/**
 * Host approves the refund (full deposit or a smaller amount) or rejects it with a note.
 * Works with or without a guest request. Approval hands it to the accountant; rejection
 * closes the booking.
 */
export async function decideDepositRefundOnNeon(
  claims: SessionClaims,
  propertyId: string,
  bookingId: string,
  input: { decision: 'approve' | 'reject'; amount?: string | undefined; note?: string | undefined },
): Promise<{ refundStatus: DepositRefundStatus; bookingStatus: string }> {
  if (!canDecideDepositRefunds(claims)) fail('forbidden');
  const note = cleanNote(input.note);
  if (input.decision === 'reject' && (!note || note.length < 3)) fail('refund_note_required');

  return withinViewerTenant(claims, async (tx) => {
    const booking = await loadHostBooking(tx, claims, propertyId, bookingId);
    if (booking.status !== 'checked_out') fail('refund_not_open');
    const deposit = await depositOf(tx, booking);
    if (deposit <= 0n) fail('refund_no_deposit');
    const existing = await currentRefund(tx, booking);
    if (existing && existing.status !== 'requested') fail('refund_already_decided');
    if (!(await hasBookingReview(tx, booking.id, 'host_to_guest'))) fail('review_required');

    const amount =
      input.decision === 'approve' && input.amount
        ? decimalToMinor(input.amount, booking.currency)
        : (existing?.amountMinor ?? deposit);
    if (amount <= 0n || amount > deposit) fail('invalid_amount');

    const status: DepositRefundStatus = input.decision === 'approve' ? 'approved' : 'rejected';
    const now = new Date();
    let refundId = existing?.id;
    if (existing) {
      await tx
        .update(stayRefunds)
        .set({
          status,
          amountMinor: amount,
          approvedByUserId: claims.sub,
          approvedAt: now,
          updatedAt: now,
        })
        .where(eq(stayRefunds.id, existing.id));
    } else {
      const [created] = await tx
        .insert(stayRefunds)
        .values({
          organizationId: booking.organizationId,
          bookingId: booking.id,
          status,
          amountMinor: amount,
          currency: booking.currency,
          requestedByUserId: claims.sub,
          approvedByUserId: claims.sub,
          approvedAt: now,
          idempotencyKey: refundKey(booking.id),
        })
        .returning({ id: stayRefunds.id });
      refundId = created!.id;
      await recordDepositEvent(tx, booking, {
        event: 'requested',
        actorUserId: claims.sub,
        metadata: { refundId, by: 'host', note: null, payout: null },
        audit: { amountMinor: deposit.toString(), by: 'host' },
      });
    }
    await recordDepositEvent(tx, booking, {
      event: status,
      actorUserId: claims.sub,
      metadata: {
        refundId,
        note,
        amountMinor: amount.toString(),
        depositMinor: deposit.toString(),
        ...(status === 'rejected'
          ? {
              retainedMinor: deposit.toString(),
              receipts: depositReceiptNumbers(booking.referenceCode),
            }
          : {}),
        decidedBy: await actorName(tx, claims.sub),
      },
      audit: { amountMinor: amount.toString(), depositMinor: deposit.toString() },
    });
    await queueGuestRefundNotice(
      tx,
      booking,
      status === 'approved'
        ? { event: 'approved', amountMinor: amount, note }
        : { event: 'rejected', note },
    );
    const bookingStatus =
      status === 'rejected'
        ? await closeBooking(tx, booking, claims.sub, 'deposit_refund_rejected')
        : booking.status;
    return { refundStatus: status, bookingStatus };
  });
}

export type RefundPayoutInput = {
  method: RefundPayoutMethod;
  account: string;
  bank: string;
  holder?: string | undefined;
  reference?: string | undefined;
  note?: string | undefined;
  at: string;
  receipt: string;
};

/** Accountant records the transfer of an approved refund, with its receipt; closes the booking. */
export async function recordDepositRefundPayoutOnNeon(
  claims: SessionClaims,
  propertyId: string,
  bookingId: string,
  input: RefundPayoutInput,
): Promise<{ refundStatus: DepositRefundStatus; bookingStatus: string }> {
  if (!canPayDepositRefunds(claims)) fail('forbidden');
  if (!validPayoutAccount(input.method, input.account)) fail('refund_account_invalid');
  if (!input.bank.trim()) fail('invalid_body');
  if (input.receipt.length > REFUND_RECEIPT_MAX || !REFUND_RECEIPT_DATA_URL.test(input.receipt)) {
    fail('refund_receipt_required');
  }
  const at = muscatLocalToDate(input.at);
  if (Number.isNaN(at.getTime())) fail('invalid_body');
  if (at.getTime() > Date.now() + FUTURE_TOLERANCE_MS) fail('stay_time_in_future');

  return withinViewerTenant(claims, async (tx) => {
    const booking = await loadHostBooking(tx, claims, propertyId, bookingId);
    const refund = await currentRefund(tx, booking);
    if (refund?.status !== 'approved') fail('refund_not_approved');
    const due = refund.amountMinor - refund.paidMinor;
    if (due <= 0n) fail('refund_not_approved');
    const decision = await refundDecision(tx, booking, refund.id);
    const deposit = decision.depositMinor ?? (await depositOf(tx, booking));
    const retained = deposit > refund.amountMinor ? deposit - refund.amountMinor : 0n;
    const receipts = depositReceiptNumbers(booking.referenceCode);
    const now = new Date();
    await tx
      .update(stayRefunds)
      .set({
        status: 'executed',
        executedAt: at,
        paidMinor: refund.amountMinor,
        transferRecordedAt: now,
        guestReceipt: null,
        guestReceiptAt: null,
        updatedAt: now,
      })
      .where(eq(stayRefunds.id, refund.id));
    const transfer: Omit<RefundTransfer, 'hasReceipt'> = {
      method: input.method,
      account: input.account.trim(),
      bank: input.bank.trim(),
      holder: input.holder?.trim() || null,
      reference: input.reference?.trim() || null,
      at: at.toISOString(),
      recordedBy: await actorName(tx, claims.sub),
      note: cleanNote(input.note),
    };
    await recordDepositEvent(tx, booking, {
      event: 'paid',
      actorUserId: claims.sub,
      metadata: {
        refundId: refund.id,
        transfer,
        receipt: input.receipt,
        amountMinor: due.toString(),
        totalMinor: refund.amountMinor.toString(),
        depositMinor: deposit.toString(),
        retainedMinor: retained.toString(),
        receipts,
      },
      audit: {
        amountMinor: due.toString(),
        totalMinor: refund.amountMinor.toString(),
        depositMinor: deposit.toString(),
        retainedMinor: retained.toString(),
        receipts,
        at: transfer.at,
        bank: transfer.bank,
        account: maskAccount(transfer.account),
      },
    });
    await queueGuestRefundNotice(tx, booking, {
      event: 'paid',
      amountMinor: due,
      paidTo: [transfer.bank, maskAccount(transfer.account)].filter(Boolean).join(' · '),
      at,
      depositMinor: deposit,
      retainedMinor: retained,
      note: decision.note,
      transferNote: transfer.note ?? null,
    });
    const bookingStatus = await closeBooking(tx, booking, claims.sub, 'deposit_refund_paid');
    return { refundStatus: 'executed', bookingStatus };
  });
}

/** The host's decision on a refund: the deposit it was taken from and its note. */
export async function refundDecision(
  tx: Tx,
  booking: RefundBooking,
  refundId: string,
): Promise<{ depositMinor: bigint | null; note: string | null }> {
  const [decision] = await tx
    .select({
      depositMinor: sql<string | null>`${stayBookingStatusHistory.metadataJson}->>'depositMinor'`,
      note: sql<string | null>`${stayBookingStatusHistory.metadataJson}->>'note'`,
    })
    .from(stayBookingStatusHistory)
    .where(
      and(
        eq(stayBookingStatusHistory.organizationId, booking.organizationId),
        eq(stayBookingStatusHistory.bookingId, booking.id),
        eq(stayBookingStatusHistory.toStatus, HISTORY_STATUS),
        sql`${stayBookingStatusHistory.metadataJson}->>'refundId' = ${refundId}`,
        sql`${stayBookingStatusHistory.metadataJson}->>'event' in ('approved', 'rejected')`,
      ),
    )
    .orderBy(desc(stayBookingStatusHistory.createdAt))
    .limit(1);
  return {
    depositMinor:
      decision?.depositMinor && /^\d+$/.test(decision.depositMinor)
        ? BigInt(decision.depositMinor)
        : null,
    note: text(decision?.note),
  };
}

/** Deposit a refund is measured against: the one recorded at the decision, else the profile's. */
export async function refundDepositMinor(
  tx: Tx,
  booking: RefundBooking,
  refundId: string,
): Promise<bigint> {
  return (
    (await refundDecision(tx, booking, refundId)).depositMinor ?? (await depositOf(tx, booking))
  );
}

/** Deposit still kept by the property: all of it after a rejection, else what was deducted. */
export function keptOfRefund(
  refund: { status: string; amountMinor: bigint },
  deposit: bigint,
): bigint {
  if (refund.status === 'rejected') return deposit;
  return deposit > refund.amountMinor ? deposit - refund.amountMinor : 0n;
}

type Adjustment = {
  claimId: string;
  note: string | null;
  by: string | null;
  actorUserId: string | null;
};

/**
 * A claim decided for the guest gives back more of the deposit: the refund grows by `extra`
 * (a rejected refund becomes an approved one of `extra`) and waits for the accountant, who
 * transfers only the difference. The property's kept income shrinks once it is paid.
 */
export async function addToDepositRefund(
  tx: Tx,
  booking: RefundBooking,
  extra: bigint,
  meta: Adjustment,
): Promise<void> {
  const refund = await currentRefund(tx, booking);
  if (!refund) fail('refund_not_decided');
  if (refund.status === 'requested') fail('refund_decide_first');
  const deposit = await refundDepositMinor(tx, booking, refund.id);
  if (extra <= 0n || extra > keptOfRefund(refund, deposit)) fail('claim_amount_invalid');
  const rejected = refund.status === 'rejected';
  const amount = (rejected ? 0n : refund.amountMinor) + extra;
  const now = new Date();
  await tx
    .update(stayRefunds)
    .set({
      status: 'approved',
      amountMinor: amount,
      ...(rejected ? { paidMinor: 0n } : {}),
      updatedAt: now,
    })
    .where(eq(stayRefunds.id, refund.id));
  await recordDepositEvent(tx, booking, {
    event: 'adjusted',
    actorUserId: meta.actorUserId,
    metadata: {
      refundId: refund.id,
      claimId: meta.claimId,
      extraMinor: extra.toString(),
      amountMinor: amount.toString(),
      depositMinor: deposit.toString(),
      note: meta.note,
      by: meta.by,
    },
    audit: { claimId: meta.claimId, extraMinor: extra.toString(), amountMinor: amount.toString() },
  });
}

/**
 * The guest never received the last transfer and the host (or the site administration)
 * agrees: the transfer is voided and the refund waits for the accountant to send it again.
 */
export async function voidLastDepositTransfer(
  tx: Tx,
  booking: RefundBooking,
  meta: Adjustment,
): Promise<bigint> {
  const refund = await currentRefund(tx, booking);
  if (refund?.status !== 'executed' || refund.paidMinor <= 0n) {
    fail('claim_not_received_invalid');
  }
  const [last] = await tx
    .select({
      amountMinor: sql<string | null>`${stayBookingStatusHistory.metadataJson}->>'amountMinor'`,
    })
    .from(stayBookingStatusHistory)
    .where(
      and(
        eq(stayBookingStatusHistory.organizationId, booking.organizationId),
        eq(stayBookingStatusHistory.bookingId, booking.id),
        eq(stayBookingStatusHistory.toStatus, HISTORY_STATUS),
        sql`${stayBookingStatusHistory.metadataJson}->>'refundId' = ${refund.id}`,
        sql`${stayBookingStatusHistory.metadataJson}->>'event' = 'paid'`,
      ),
    )
    .orderBy(desc(stayBookingStatusHistory.createdAt))
    .limit(1);
  const lastMinor =
    last?.amountMinor && /^\d+$/.test(last.amountMinor) ? BigInt(last.amountMinor) : null;
  const voided = lastMinor && lastMinor <= refund.paidMinor ? lastMinor : refund.paidMinor;
  await tx
    .update(stayRefunds)
    .set({
      status: 'approved',
      paidMinor: refund.paidMinor - voided,
      transferRecordedAt: null,
      guestReceipt: null,
      guestReceiptAt: null,
      updatedAt: new Date(),
    })
    .where(eq(stayRefunds.id, refund.id));
  await recordDepositEvent(tx, booking, {
    event: 'transfer_voided',
    actorUserId: meta.actorUserId,
    metadata: {
      refundId: refund.id,
      claimId: meta.claimId,
      amountMinor: voided.toString(),
      note: meta.note,
      by: meta.by,
    },
    audit: { claimId: meta.claimId, amountMinor: voided.toString() },
  });
  return voided;
}

/** Transfer receipt of a refund; booking managers, refund approvers and accountants only. */
export async function readDepositRefundReceiptOnNeon(
  claims: SessionClaims,
  propertyId: string,
  bookingId: string,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  if (
    !claims.organizationId ||
    (!canDecideDepositRefunds(claims) && !canPayDepositRefunds(claims))
  ) {
    return null;
  }
  const orgId = claims.organizationId;
  const ownerPartyId = ownerPartyScope(claims);
  return withinViewerTenant(claims, async (tx) => {
    const [row] = await tx
      .select({
        receipt: sql<string | null>`${stayBookingStatusHistory.metadataJson}->>'receipt'`,
      })
      .from(stayBookingStatusHistory)
      .innerJoin(stayBookings, eq(stayBookings.id, stayBookingStatusHistory.bookingId))
      .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
      .where(
        and(
          eq(stayBookingStatusHistory.organizationId, orgId),
          eq(stayBookingStatusHistory.bookingId, bookingId),
          eq(stayBookingStatusHistory.toStatus, HISTORY_STATUS),
          sql`(${stayBookingStatusHistory.metadataJson}->>'receipt') is not null`,
          eq(stayBookings.propertyId, propertyId),
          eq(properties.organizationId, orgId),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .orderBy(desc(stayBookingStatusHistory.createdAt))
      .limit(1);
    const match = row?.receipt?.match(REFUND_RECEIPT_DATA_URL);
    if (!match) return null;
    return { mimeType: match[1]!, bytes: Buffer.from(match[2]!, 'base64') };
  });
}

export type DepositRefundQueueItem = {
  bookingId: string;
  reference: string;
  propertyId: string;
  propertyNameAr: string;
  propertyNameEn: string | null;
  unitCode: string | null;
  party: string | null;
  /** decision: waiting for the host; transfer: approved, waiting for the accountant. */
  step: 'decision' | 'transfer';
  /** Still to transfer (approved minus already paid); null while awaiting the decision. */
  dueMinor: string | null;
  currency: string;
  since: string;
};

/** Checked-out stays whose deposit refund still waits on the host or the accountant. */
export async function loadDepositRefundQueue(
  tx: Pick<Tx, 'select'>,
  orgId: string,
  scope: { ownerPartyId?: string | null; propertyId?: string | null; limit?: number } = {},
): Promise<DepositRefundQueueItem[]> {
  const rows = await tx
    .select({
      bookingId: stayBookings.id,
      reference: stayBookings.referenceCode,
      propertyId: properties.id,
      propertyNameAr: properties.nameAr,
      propertyNameEn: properties.nameEn,
      unitCode: units.code,
      party: sql<
        string | null
      >`${stayBookings.pricingSnapshotJson}->'guestContact'->>'displayName'`,
      refundStatus: stayRefunds.status,
      refundAmountMinor: stayRefunds.amountMinor,
      refundPaidMinor: stayRefunds.paidMinor,
      currency: stayBookings.currency,
      refundUpdatedAt: stayRefunds.updatedAt,
      bookingUpdatedAt: stayBookings.updatedAt,
    })
    .from(stayBookings)
    .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
    .innerJoin(stayProfiles, eq(stayProfiles.id, stayBookings.stayProfileId))
    .leftJoin(units, eq(units.id, stayBookings.unitId))
    .leftJoin(
      stayRefunds,
      and(
        eq(stayRefunds.organizationId, stayBookings.organizationId),
        eq(stayRefunds.idempotencyKey, sql`'deposit:' || ${stayBookings.id}::text`),
      ),
    )
    .where(
      and(
        eq(stayBookings.organizationId, orgId),
        eq(stayBookings.status, 'checked_out'),
        sql`${stayProfiles.depositMinor} > 0`,
        ...(scope.propertyId ? [eq(stayBookings.propertyId, scope.propertyId)] : []),
        ...(scope.ownerPartyId ? [eq(properties.ownerPartyId, scope.ownerPartyId)] : []),
      ),
    )
    .orderBy(asc(stayBookings.updatedAt))
    .limit(scope.limit ?? 50);
  return rows.flatMap((row) => {
    const step =
      !row.refundStatus || row.refundStatus === 'requested'
        ? ('decision' as const)
        : row.refundStatus === 'approved'
          ? ('transfer' as const)
          : null;
    if (!step) return [];
    return [
      {
        bookingId: row.bookingId,
        reference: row.reference,
        propertyId: row.propertyId,
        propertyNameAr: row.propertyNameAr,
        propertyNameEn: row.propertyNameEn,
        unitCode: row.unitCode,
        party: row.party,
        step,
        dueMinor:
          step === 'transfer' && row.refundAmountMinor !== null
            ? (row.refundAmountMinor - (row.refundPaidMinor ?? 0n)).toString()
            : null,
        currency: row.currency,
        since: iso(row.refundUpdatedAt ?? row.bookingUpdatedAt) ?? '',
      },
    ];
  });
}
