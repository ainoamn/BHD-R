import type { BookingReviewMoment } from '@/lib/booking-reviews-neon';
import type { StayStamp } from '@/lib/stay-arrival-neon';
import {
  claimKindLabel,
  depositReceiptState,
  type DepositClaimView,
} from '@/lib/stay-deposit-claims';
import { hasDeposit, maskAccount, type DepositRefundView } from '@/lib/stay-deposit-refund';
import type { StayBookingPaymentLine } from '@/lib/stay-booking-payments';
import {
  stayPaymentKindLabel,
} from '@/lib/stay-booking-payment-labels';
import { displayStayCheckoutOn } from '@/lib/stay-period-times';
import { stayStatusLabel, stayTypeLabel } from '@/lib/ui-labels';

export type StayTimelineHistory = {
  at: string;
  toStatus: string;
  fromStatus: string | null;
  reason: string | null;
  by: string | null;
  note: string | null;
  /** Selected fields from status-history metadata for reschedule / payment detail. */
  detail: {
    fromCheckInOn?: string;
    fromCheckOutOn?: string;
    toCheckInOn?: string;
    toCheckOutOn?: string;
    fromStayType?: string;
    toStayType?: string;
    stayType?: string;
    checkInOn?: string;
    checkOutOn?: string;
    checkInTime?: string;
    checkOutTime?: string;
    fromCheckInTime?: string;
    fromCheckOutTime?: string;
    toCheckInTime?: string;
    toCheckOutTime?: string;
    extraDueMinor?: string;
    quotedTotalMinor?: string;
    chargedTotalMinor?: string;
    originalTotalMinor?: string;
    forfeitedMinor?: string;
    depositMinor?: string;
    paymentIntentId?: string;
    amendmentReference?: string;
    amendmentContractId?: string;
    contractReference?: string;
    contractId?: string;
  } | null;
};

/** Everything that happened to a stay booking, as the host's booking page shows it. */
export type StayBookingTimelineFacts = {
  history: StayTimelineHistory[];
  payments: StayBookingPaymentLine[];
  checkIn: StayStamp | null;
  checkOut: StayStamp | null;
  depositMinor: string | null;
  refund: DepositRefundView | null;
  claims: DepositClaimView[];
  /** The guest's review only once released. */
  reviews: BookingReviewMoment[];
};

export type StayTimelineTone = 'done' | 'info' | 'warn' | 'danger';

export type StayTimelineEvent = {
  key: string;
  at: string;
  tone: StayTimelineTone;
  title: string;
  detail: string | null;
  by: string | null;
};

export type StayTimelineStep = {
  key: string;
  label: string;
  state: 'done' | 'current' | 'upcoming';
  at: string | null;
};

export type StayBookingTimeline = {
  steps: StayTimelineStep[];
  /** Newest first. */
  events: StayTimelineEvent[];
  waiting: string[];
  next: { label: string; href: string } | null;
};

const ENDED = new Set(['cancelled', 'expired', 'no_show', 'rejected']);
const DEPARTED = new Set(['checked_out', 'closed']);
const AWAITING_ARRIVAL = new Set(['confirmed', 'paid', 'pre_arrival']);
/** Status history rows told better by the stamps, the refund and the claims. */
const TOLD_ELSEWHERE = new Set(['checked_in', 'checked_out', 'deposit_refund']);

function dateRange(
  from: string | undefined,
  to: string | undefined,
  stayType?: string | undefined,
): string | null {
  if (!from) return null;
  const displayOut = to ? displayStayCheckoutOn(stayType, from, to) : from;
  if (!to || displayOut === from.slice(0, 10)) return from.slice(0, 10);
  return `${from.slice(0, 10)} → ${displayOut}`;
}

function stayLabel(value: string | undefined, ar: boolean): string | null {
  if (!value) return null;
  return stayTypeLabel(value, ar);
}

function withTimes(
  range: string | null,
  checkInTime?: string | undefined,
  checkOutTime?: string | undefined,
): string | null {
  if (!range) return null;
  if (checkInTime && checkOutTime) return `${range} · ${checkInTime}–${checkOutTime}`;
  if (checkInTime) return `${range} · ${checkInTime}`;
  return range;
}

function historyEvent(
  row: StayTimelineHistory,
  index: number,
  ar: boolean,
  request: boolean,
  money: (minor: string) => string,
): StayTimelineEvent | null {
  if (TOLD_ELSEWHERE.has(row.toStatus)) return null;
  const reason = row.reason ?? '';
  const d = row.detail;
  const freeText =
    row.note ||
    (reason && !/^[a-z0-9_]+$/i.test(reason) && !reason.startsWith('Sandbox') ? reason : null);
  const base = { key: `h${index}`, at: row.at, by: row.by };

  if (reason === 'guest_reschedule_requested') {
    const range = withTimes(
      dateRange(d?.checkInOn, d?.checkOutOn, d?.stayType),
      d?.checkInTime ?? d?.toCheckInTime,
      d?.checkOutTime ?? d?.toCheckOutTime,
    );
    const stay = stayLabel(d?.stayType, ar);
    const extra =
      d?.extraDueMinor && d.extraDueMinor !== '0'
        ? ar
          ? `فرق مستحق: ${money(d.extraDueMinor)}`
          : `Top-up due: ${money(d.extraDueMinor)}`
        : ar
          ? 'بدون فرق سعر'
          : 'No price difference';
    return {
      ...base,
      tone: 'warn',
      title: ar ? 'طلب الضيف تعديل التواريخ / الفترة' : 'Guest requested a date / period change',
      detail: [range ? (ar ? `إلى: ${range}` : `To: ${range}`) : null, stay, extra]
        .filter(Boolean)
        .join('\n') || null,
    };
  }
  if (reason === 'owner_rejected_reschedule') {
    const declined = withTimes(
      dateRange(d?.checkInOn, d?.checkOutOn, d?.stayType),
      d?.checkInTime,
      d?.checkOutTime,
    );
    return {
      ...base,
      tone: 'danger',
      title: ar ? 'رفض المالك طلب تعديل التواريخ' : 'Host declined the date-change request',
      detail:
        freeText ||
        (declined
          ? ar
            ? `الطلب المرفوض: ${declined}`
            : `Declined request: ${declined}`
          : null),
    };
  }
  if (reason === 'owner_approved_reschedule' || reason === 'owner_approved_reschedule_awaiting_payment') {
    const awaitingPay = reason === 'owner_approved_reschedule_awaiting_payment';
    const extra =
      d?.extraDueMinor && d.extraDueMinor !== '0' ? money(d.extraDueMinor) : null;
    const range = withTimes(
      dateRange(d?.checkInOn, d?.checkOutOn, d?.stayType) ||
        dateRange(d?.toCheckInOn, d?.toCheckOutOn, d?.toStayType),
      d?.checkInTime ?? d?.toCheckInTime,
      d?.checkOutTime ?? d?.toCheckOutTime,
    );
    return {
      ...base,
      tone: awaitingPay ? 'info' : 'done',
      title: awaitingPay
        ? ar
          ? 'وافق المالك على التعديل — بانتظار دفع الفرق'
          : 'Host approved the change — awaiting top-up'
        : ar
          ? 'وافق المالك على تعديل التواريخ'
          : 'Host approved the date change',
      detail: [
        range ? (ar ? `إلى: ${range}` : `To: ${range}`) : null,
        stayLabel(d?.stayType ?? d?.toStayType, ar),
        extra
          ? ar
            ? `المبلغ المطلوب: ${extra}`
            : `Amount due: ${extra}`
          : null,
      ]
        .filter(Boolean)
        .join('\n') || null,
    };
  }
  if (reason === 'guest_rescheduled' || reason === 'reschedule_applied') {
    const from = withTimes(
      dateRange(d?.fromCheckInOn, d?.fromCheckOutOn, d?.fromStayType),
      d?.fromCheckInTime,
      d?.fromCheckOutTime,
    );
    const to = withTimes(
      dateRange(d?.toCheckInOn, d?.toCheckOutOn, d?.toStayType),
      d?.toCheckInTime,
      d?.toCheckOutTime,
    );
    const stayChange =
      d?.fromStayType || d?.toStayType
        ? `${stayLabel(d?.fromStayType, ar) ?? '—'} → ${stayLabel(d?.toStayType, ar) ?? '—'}`
        : null;
    const charged =
      d?.chargedTotalMinor || d?.quotedTotalMinor
        ? ar
          ? `المبلغ بعد التعديل: ${money(d.chargedTotalMinor || d.quotedTotalMinor || '0')}`
          : `Amount after change: ${money(d.chargedTotalMinor || d.quotedTotalMinor || '0')}`
        : null;
    const amendment =
      d?.amendmentReference || d?.contractReference
        ? ar
          ? `ملحق العقد: ${d.amendmentReference || d.contractReference}`
          : `Contract addendum: ${d.amendmentReference || d.contractReference}`
        : null;
    return {
      ...base,
      tone: 'done',
      title: ar ? 'طُبّق تعديل التواريخ / نوع الإقامة' : 'Date / stay-type change applied',
      detail: [
        from && to ? (ar ? `من: ${from}\nإلى: ${to}` : `From: ${from}\nTo: ${to}`) : to || from,
        stayChange,
        charged,
        amendment,
      ]
        .filter(Boolean)
        .join('\n') || null,
    };
  }
  if (reason === 'stay_contract_issued' || reason === 'contract_issued') {
    return {
      ...base,
      tone: 'done',
      title: ar ? 'أُصدر عقد الإقامة' : 'Stay contract issued',
      detail: d?.contractReference
        ? ar
          ? `رقم العقد: ${d.contractReference}`
          : `Contract: ${d.contractReference}`
        : null,
    };
  }
  if (reason === 'deposit_waived') {
    return {
      ...base,
      tone: 'warn',
      title: ar ? 'استُثني مبلغ التأمين يدوياً' : 'Security deposit waived by host',
      detail: d?.depositMinor
        ? ar
          ? `المبلغ المستثنى: ${money(d.depositMinor)}`
          : `Waived amount: ${money(d.depositMinor)}`
        : null,
    };
  }
  if (/electronic signature/i.test(reason) || reason === 'esign_completed') {
    return {
      ...base,
      tone: 'done',
      title: ar ? 'وقّع الضيف عقد الإقامة إلكترونياً' : 'Guest signed the stay contract',
      detail: null,
    };
  }
  if (reason === 'public_booking_created') {
    return {
      ...base,
      tone: 'info',
      title: ar ? 'أُنشئ الحجز' : 'Booking created',
      detail: null,
    };
  }
  if (/sandbox payment|payment/i.test(reason) && row.toStatus === 'confirmed') {
    return {
      ...base,
      tone: 'done',
      title: request
        ? ar
          ? 'اعتُمد طلب الحجز بعد الدفع'
          : 'Booking request approved after payment'
        : ar
          ? 'تأكّد الحجز بعد الدفع'
          : 'Booking confirmed after payment',
      detail: null,
    };
  }

  const freeReason =
    reason && !/^[a-z0-9_]+$/i.test(reason) && !reason.startsWith('Sandbox') ? reason : null;

  switch (row.toStatus) {
    case 'request_pending':
      return {
        ...base,
        tone: 'info',
        title: ar ? 'وصل طلب الحجز' : 'Booking request received',
        detail: null,
      };
    case 'payment_pending':
      return {
        ...base,
        tone: 'info',
        title: ar ? 'بانتظار دفع الضيف' : 'Awaiting guest payment',
        detail: null,
      };
    case 'confirmed':
      // Same-status ops without a known reason — skip noisy "confirmed" repeats.
      if (row.fromStatus === 'confirmed' && !freeReason && !freeText) return null;
      return {
        ...base,
        tone: 'done',
        title: request
          ? ar
            ? 'اعتُمد طلب الحجز'
            : 'Booking request approved'
          : ar
            ? 'تأكّد الحجز'
            : 'Booking confirmed',
        detail: freeText || freeReason,
      };
    case 'paid':
      return { ...base, tone: 'done', title: ar ? 'تم الدفع' : 'Paid', detail: null };
    case 'pre_arrival':
      return {
        ...base,
        tone: 'info',
        title: ar ? 'الحجز جاهز للوصول' : 'Ready for arrival',
        detail: null,
      };
    case 'closed':
      return {
        ...base,
        tone: 'done',
        title: ar ? 'أُغلق الحجز' : 'Booking closed',
        detail: null,
      };
    case 'cancelled':
      return {
        ...base,
        tone: 'danger',
        title: ar ? 'أُلغي الحجز' : 'Booking cancelled',
        detail: freeText,
      };
    case 'rejected':
      return {
        ...base,
        tone: 'danger',
        title: ar ? 'رُفض الطلب' : 'Request declined',
        detail: freeText,
      };
    case 'expired':
      return {
        ...base,
        tone: 'danger',
        title: ar ? 'انتهت مهلة الطلب' : 'Request expired',
        detail: freeText,
      };
    case 'no_show':
      return {
        ...base,
        tone: 'danger',
        title: ar ? 'لم يحضر الضيف' : 'Guest did not show',
        detail: freeText,
      };
    default:
      return {
        ...base,
        tone: 'info',
        title: stayStatusLabel(row.toStatus, ar),
        detail: freeText || freeReason,
      };
  }
}

function stampDetail(stamp: StayStamp, ar: boolean): string | null {
  const lines = [
    stamp.recipient?.name ? `${ar ? 'المستلم' : 'Received by'}: ${stamp.recipient.name}` : null,
    stamp.photos.length
      ? ar
        ? `صور حالة الوحدة: ${stamp.photos.length}`
        : `Unit condition photos: ${stamp.photos.length}`
      : null,
    stamp.notes,
  ].filter((line): line is string => Boolean(line));
  return lines.length ? lines.join('\n') : null;
}

function scoreText(score: number | null): string {
  return score === null ? '' : ` ${score.toFixed(1)}`;
}

/**
 * The host's view of a stay booking: the stages with their dates, every recorded step
 * newest first, what is still awaited, and the host's next action.
 */
export function buildStayBookingTimeline(
  input: {
    bookingId: string;
    propertyId: string;
    status: string;
    bookingMode: string;
    createdAt: string;
    facts: StayBookingTimelineFacts;
    portal: 'owner' | 'developer';
  },
  ar: boolean,
  money: (minor: string) => string,
  stamp: (iso: string) => string,
  now = Date.now(),
): StayBookingTimeline {
  const { facts, status } = input;
  const request =
    input.bookingMode === 'request' ||
    facts.history.some((row) => row.toStatus === 'request_pending');
  const deposit = hasDeposit(facts.depositMinor);
  const refund = facts.refund;
  const receipt = refund
    ? depositReceiptState(
        {
          status: refund.status,
          guestReceipt: refund.guestReceipt,
          transferRecordedAt: refund.transferRecordedAt,
        },
        now,
      )
    : null;
  const hostReview = facts.reviews.find((review) => review.direction === 'host_to_guest') ?? null;
  const guestReview = facts.reviews.find((review) => review.direction === 'guest_to_host') ?? null;
  const openClaim = facts.claims.find(
    (claim) => claim.status === 'open' || claim.status === 'escalated',
  );

  const events: StayTimelineEvent[] = [];
  facts.history.forEach((row, index) => {
    const event = historyEvent(row, index, ar, request, money);
    if (event) events.push(event);
  });
  if (!facts.history.some((row) => row.toStatus === 'request_pending' || row.reason === 'public_booking_created')) {
    events.push({
      key: 'created',
      at: input.createdAt,
      tone: 'info',
      title: request
        ? ar
          ? 'وصل طلب الحجز'
          : 'Booking request received'
        : ar
          ? 'أُنشئ الحجز'
          : 'Booking created',
      detail: null,
      by: null,
    });
  }

  for (const pay of facts.payments) {
    if (pay.status !== 'succeeded') continue;
    events.push({
      key: `pay-${pay.id}`,
      at: pay.paidAt ?? input.createdAt,
      tone: 'done',
      title: ar
        ? `دُفع ${money(pay.amountMinor)} · ${stayPaymentKindLabel(pay.kind, true)}`
        : `Paid ${money(pay.amountMinor)} · ${stayPaymentKindLabel(pay.kind, false)}`,
      detail: pay.providerIntentId
        ? ar
          ? `مرجع المزود: ${pay.providerIntentId}`
          : `Provider ref: ${pay.providerIntentId}`
        : null,
      by: null,
    });
  }

  if (facts.checkIn) {
    events.push({
      key: 'check-in',
      at: facts.checkIn.at,
      tone: 'done',
      title: ar ? 'وصل الضيف وتسلّم العقار' : 'Guest arrived and received the unit',
      detail: stampDetail(facts.checkIn, ar),
      by: facts.checkIn.recordedBy,
    });
  }
  if (facts.checkOut) {
    events.push({
      key: 'check-out',
      at: facts.checkOut.at,
      tone: facts.checkOut.important ? 'warn' : 'done',
      title: ar ? 'غادر الضيف واستُلم العقار' : 'Guest left and the unit was received back',
      detail: stampDetail(facts.checkOut, ar),
      by: facts.checkOut.recordedBy,
    });
  }

  if (refund) {
    const held = refund.settledDepositMinor ?? facts.depositMinor;
    events.push({
      key: 'refund-requested',
      at: refund.requestedAt,
      tone: 'info',
      title:
        refund.requestedBy === 'guest'
          ? ar
            ? 'طلب الضيف استرداد التأمين'
            : 'Guest asked for the deposit back'
          : ar
            ? 'فُتح استرداد التأمين'
            : 'Deposit refund opened',
      detail:
        [held ? `${ar ? 'مبلغ التأمين' : 'Deposit'}: ${money(held)}` : null, refund.guestNote]
          .filter(Boolean)
          .join('\n') || null,
      by: null,
    });
    if (refund.decidedAt && refund.status !== 'requested') {
      const rejected = refund.status === 'rejected';
      events.push({
        key: 'refund-decided',
        at: refund.decidedAt,
        tone: rejected ? 'danger' : 'done',
        title: rejected
          ? ar
            ? 'رُفض استرداد التأمين'
            : 'Deposit refund declined'
          : held
            ? ar
              ? `الموافقة على استرداد ${money(refund.amountMinor)} من ${money(held)}`
              : `Refund of ${money(refund.amountMinor)} of ${money(held)} approved`
            : ar
              ? `الموافقة على استرداد ${money(refund.amountMinor)}`
              : `Refund of ${money(refund.amountMinor)} approved`,
        detail: refund.decisionNote,
        by: refund.decidedBy,
      });
    }
    if (refund.transfer) {
      const amount = refund.transfer.amountMinor ?? refund.paidMinor;
      const to = [refund.transfer.bank, maskAccount(refund.transfer.account)]
        .filter(Boolean)
        .join(' · ');
      events.push({
        key: 'refund-transfer',
        at:
          refund.transfer.at || refund.transferRecordedAt || refund.decidedAt || refund.requestedAt,
        tone: 'done',
        title: ar ? `حُوّل ${money(amount)} إلى ${to}` : `${money(amount)} transferred to ${to}`,
        detail: refund.transfer.note ?? null,
        by: refund.transfer.recordedBy,
      });
    }
    if (receipt?.state === 'confirmed' && refund.guestReceiptAt) {
      events.push({
        key: 'refund-receipt',
        at: refund.guestReceiptAt,
        tone: 'done',
        title: ar ? 'أكّد الضيف استلام المبلغ' : 'Guest confirmed receiving the money',
        detail: null,
        by: null,
      });
    } else if (receipt?.state === 'not_received' && refund.guestReceiptAt) {
      events.push({
        key: 'refund-receipt',
        at: refund.guestReceiptAt,
        tone: 'warn',
        title: ar ? 'أبلغ الضيف أن المبلغ لم يصل' : 'Guest reported the money did not arrive',
        detail: null,
        by: null,
      });
    } else if (receipt?.state === 'auto' && receipt.deadline) {
      events.push({
        key: 'refund-receipt',
        at: receipt.deadline,
        tone: 'done',
        title: ar
          ? 'اعتُبر الاستلام مؤكداً بعد 24 ساعة دون اعتراض'
          : 'Receipt counted as confirmed after 24 hours without objection',
        detail: null,
        by: null,
      });
    }
  }

  for (const claim of facts.claims) {
    const amount = claim.amountMinor ? ` · ${money(claim.amountMinor)}` : '';
    events.push({
      key: `claim-${claim.id}`,
      at: claim.createdAt,
      tone: 'warn',
      title: `${ar ? 'مطالبة من الضيف' : 'Guest claim'}: ${claimKindLabel(claim.kind, ar)}${amount}`,
      detail: claim.message || null,
      by: null,
    });
    if (claim.response) {
      events.push({
        key: `claim-${claim.id}-response`,
        at: claim.response.at,
        tone: claim.response.decision === 'accepted' ? 'done' : 'info',
        title:
          claim.response.decision === 'accepted'
            ? ar
              ? 'قُبلت مطالبة الضيف'
              : 'Guest claim accepted'
            : ar
              ? 'رُفضت مطالبة الضيف'
              : 'Guest claim declined',
        detail: claim.response.note,
        by: claim.response.by,
      });
    }
    if (claim.escalation) {
      events.push({
        key: `claim-${claim.id}-escalation`,
        at: claim.escalation.at,
        tone: 'danger',
        title: ar
          ? 'صعّد الضيف المطالبة إلى إدارة الموقع'
          : 'Guest escalated the claim to the site administration',
        detail: claim.escalation.message,
        by: null,
      });
    }
    if (claim.resolution) {
      events.push({
        key: `claim-${claim.id}-resolution`,
        at: claim.resolution.at,
        tone: 'info',
        title:
          claim.resolution.outcome === 'guest'
            ? ar
              ? 'بتّت إدارة الموقع لصالح الضيف'
              : 'Site administration decided for the guest'
            : ar
              ? 'بتّت إدارة الموقع لصالح المالك'
              : 'Site administration decided for the host',
        detail: claim.resolution.note,
        by: claim.resolution.by,
      });
    }
  }

  if (hostReview) {
    events.push({
      key: 'review-host',
      at: hostReview.createdAt,
      tone: 'done',
      title: ar
        ? `قُيّم الضيف${scoreText(hostReview.score)} من 10`
        : `Guest rated${scoreText(hostReview.score)} / 10`,
      detail: hostReview.released
        ? ar
          ? 'ظهر التقييم للضيف وفي ملفه العام.'
          : 'Visible to the guest and on their public profile.'
        : ar
          ? 'لا يراه الضيف قبل تحويل مبلغ التأمين وتأكيد استلامه، ثم بعد تقييمه للإقامة أو مرور 14 يوماً.'
          : 'Hidden from the guest until the deposit is transferred and receipt confirmed, then until they review or 14 days pass.',
      by: null,
    });
  }
  if (guestReview) {
    events.push({
      key: 'review-guest',
      at: guestReview.createdAt,
      tone: 'done',
      title: ar
        ? `قيّم الضيف إقامته${scoreText(guestReview.score)} من 10`
        : `Guest rated the stay${scoreText(guestReview.score)} / 10`,
      detail: ar
        ? 'ظاهر في صفحة العقار وملف المؤجر.'
        : 'Shown on the property page and host profile.',
      by: null,
    });
  }

  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const depositDone =
    !deposit ||
    refund?.status === 'rejected' ||
    (refund?.status === 'executed' &&
      (receipt?.state === 'confirmed' || receipt?.state === 'auto'));
  const atOf = (toStatus: string) =>
    facts.history.find((row) => row.toStatus === toStatus)?.at ?? null;
  const ended = ENDED.has(status);
  const departed = DEPARTED.has(status);

  const steps: StayTimelineStep[] = [];
  if (!ended) {
    const plan: Array<{ key: string; label: string; done: boolean; at: string | null }> = [
      {
        key: 'request',
        label: request ? (ar ? 'الطلب' : 'Request') : ar ? 'الحجز' : 'Booking',
        done: true,
        at: atOf('request_pending') ?? input.createdAt,
      },
      {
        key: 'approval',
        label: request ? (ar ? 'اعتماد الحجز' : 'Approval') : ar ? 'الدفع' : 'Payment',
        done: !['request_pending', 'payment_pending'].includes(status),
        at: atOf('confirmed') ?? atOf('paid') ?? facts.payments[0]?.paidAt ?? null,
      },
      {
        key: 'check-in',
        label: ar ? 'الوصول وتسليم العقار' : 'Check-in',
        done: Boolean(facts.checkIn) || status === 'checked_in' || departed,
        at: facts.checkIn?.at ?? null,
      },
      {
        key: 'check-out',
        label: ar ? 'المغادرة واستلام العقار' : 'Check-out',
        done: Boolean(facts.checkOut) || departed,
        at: facts.checkOut?.at ?? null,
      },
    ];
    if (deposit) {
      plan.push({
        key: 'deposit',
        label: ar ? 'استرداد التأمين' : 'Deposit refund',
        done: departed && depositDone,
        at:
          refund?.guestReceiptAt ??
          (receipt?.state === 'auto' ? receipt.deadline : null) ??
          refund?.transfer?.at ??
          refund?.decidedAt ??
          null,
      });
    }
    plan.push({
      key: 'review',
      label: ar ? 'التقييم' : 'Review',
      done: Boolean(hostReview),
      at: hostReview?.createdAt ?? null,
    });
    const current = plan.findIndex((step) => !step.done);
    plan.forEach((step, index) => {
      steps.push({
        key: step.key,
        label: step.label,
        state: step.done ? 'done' : index === current ? 'current' : 'upcoming',
        at: step.done ? step.at : null,
      });
    });
  }

  const waiting: string[] = [];
  if (refund?.status === 'approved') {
    waiting.push(
      ar
        ? 'بانتظار تحويل مبلغ الاسترداد من المحاسب.'
        : 'Awaiting the accountant’s refund transfer.',
    );
  }
  if (receipt?.state === 'pending' && receipt.deadline) {
    waiting.push(
      ar
        ? `التحويل مكتمل؛ تأكيد الاستلام اختياري من الضيف حتى ${stamp(receipt.deadline)}.`
        : `Transfer complete; optional guest confirmation until ${stamp(receipt.deadline)}.`,
    );
  }
  if (hostReview && !hostReview.released) {
    waiting.push(
      ar
        ? 'تقييمك للضيف محجوب عنه حتى تسوية التأمين وتقييمه للإقامة (أو 14 يوماً).'
        : 'Your review stays hidden from the guest until the deposit settles and they review (or 14 days).',
    );
  }

  const base = `/${input.portal}/properties/${input.propertyId}?section=bookings&focus=${input.bookingId}`;
  let next: StayBookingTimeline['next'] = null;
  if (status === 'request_pending') {
    next = {
      label: ar ? 'راجع طلب الحجز واعتمده أو ارفضه' : 'Review the booking request',
      href: base,
    };
  } else if (AWAITING_ARRIVAL.has(status)) {
    next = { label: ar ? 'سجّل وصول الضيف وتسليمه العقار' : 'Record check-in', href: base };
  } else if (status === 'checked_in') {
    next = { label: ar ? 'سجّل مغادرة الضيف واستلام العقار' : 'Record check-out', href: base };
  } else if (departed && !hostReview) {
    next = {
      label:
        deposit && (!refund || refund.status === 'requested')
          ? ar
            ? 'قيّم الضيف ثم قرّر في استرداد التأمين'
            : 'Review the guest, then decide the deposit refund'
          : ar
            ? 'قيّم الضيف'
            : 'Review the guest',
      href: `${base}&review=1`,
    };
  } else if (departed && deposit && (!refund || refund.status === 'requested')) {
    next = { label: ar ? 'قرّر في استرداد التأمين' : 'Decide the deposit refund', href: base };
  } else if (openClaim) {
    next = { label: ar ? 'ردّ على مطالبة الضيف' : 'Answer the guest’s claim', href: base };
  }

  return { steps, events, waiting, next };
}
