'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { ApiError, browserStayBookingMutation, humanizeBrowserError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { rememberStayTripAlert } from '@/lib/stay-trip-alerts';
import {
  isStayEsignRequiredClient,
  stayConfirmedReturnPath,
  stayEsignReturnPath,
} from '@/lib/stay-esign-flags';
import { ModalPortal } from '@/components/modal-portal';
import { StayAvailabilityCalendar } from '@/components/stays/stay-availability-calendar';
import { noteForLocale } from '@/lib/note-translation';
import { LIVE_CHANGE_EVENT } from '@/lib/live-sync-shared';
import { stayTypeLabel } from '@/lib/ui-labels';
import {
  displayStayCheckoutOn,
  isHalfDayStayType,
  resolveStayPeriodTimes,
} from '@/lib/stay-period-times';
import { stayArrivalWindow } from '@/lib/stay-checkin-window';

export type GuestStayActionBooking = {
  id: string;
  referenceCode: string;
  status: string;
  checkInOn: string;
  checkOutOn: string;
  currency?: string;
  totalMinor?: string;
  paymentIntentId?: string | null;
  listingSlug?: string | null;
  unitId?: string | null;
  stayType?: string | null;
  canPay?: boolean;
  canCancel?: boolean;
  canRebook?: boolean;
  canReschedule?: boolean;
  pendingReschedule?: {
    status: 'awaiting_owner' | 'awaiting_guest_payment' | 'awaiting_payment';
    checkInOn: string;
    checkOutOn: string;
    stayType: string;
    extraDueMinor: string;
    quotedTotalMinor: string;
    chargedTotalMinor: string;
    paymentRedirectUrl?: string | null;
  } | null;
  rescheduleRejection?: {
    note: string | null;
    at: string;
  } | null;
};

type StayTypeOption = 'overnight_stay' | 'day_use' | 'overnight_only';
type RescheduleMode = 'period' | 'dates' | 'both';

type RescheduleQuote = {
  currency: string;
  checkInOn: string;
  checkOutOn: string;
  nights: number;
  stayType: StayTypeOption;
  originalTotalMinor: string;
  quotedTotalMinor: string;
  chargedTotalMinor: string;
  forfeitedMinor: string;
  extraDueMinor: string;
  keptOriginalPrice: boolean;
  requiresPayment: boolean;
  hasOffer: boolean;
  paid: boolean;
};

const STAY_TYPE_OPTIONS: StayTypeOption[] = ['overnight_stay', 'day_use', 'overnight_only'];

function isHalfDayStay(type: string | null | undefined): boolean {
  return isHalfDayStayType(type);
}

function normalizeStayType(value: string | null | undefined): StayTypeOption {
  return value === 'day_use' || value === 'overnight_only' ? value : 'overnight_stay';
}

function formatStayRange(
  checkInOn: string,
  checkOutOn: string,
  stayType: string | null | undefined,
  ar: boolean,
): string {
  const displayOut = displayStayCheckoutOn(stayType, checkInOn, checkOutOn);
  if (displayOut === checkInOn.slice(0, 10)) {
    return formatDay(checkInOn, ar);
  }
  return `${formatDay(checkInOn, ar)} — ${formatDay(displayOut, ar)}`;
}

function periodSpanLabel(stayType: StayTypeOption): string {
  const times = resolveStayPeriodTimes(stayType, {});
  return `${times.checkInTime} – ${times.checkOutTime}`;
}

const PAID_STATUSES = new Set(['confirmed', 'paid', 'pre_arrival']);
const RESCHEDULABLE = new Set([
  'payment_pending',
  'payment_failed',
  'request_pending',
  'confirmed',
  'pre_arrival',
]);

function buildRebookHref(locale: string, booking: GuestStayActionBooking): string | null {
  if (!booking.listingSlug) return null;
  const qs = new URLSearchParams();
  if (booking.unitId) qs.set('unit', booking.unitId);
  if (booking.stayType) qs.set('stayType', booking.stayType);
  const q = qs.toString();
  return `/${locale}/stays/${encodeURIComponent(booking.listingSlug)}/book${q ? `?${q}` : ''}`;
}

function formatDay(iso: string, ar: boolean): string {
  return new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00.000Z`));
}

function nightsText(nights: number, ar: boolean): string {
  if (!ar) return `${nights} night${nights === 1 ? '' : 's'}`;
  if (nights === 1) return 'ليلة واحدة';
  if (nights === 2) return 'ليلتان';
  if (nights <= 10) return `${nights} ليالٍ`;
  return `${nights} ليلة`;
}

async function guestStayPost<T>(path: string, body: unknown, ar: boolean, fallback: string) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-requested-with': 'BHD-R',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => null)) as
    T | { error?: { code?: string; messageAr?: string; message?: string } } | null;
  if (!response.ok) {
    const err = payload && typeof payload === 'object' && 'error' in payload ? payload.error : null;
    throw new ApiError(
      response.status,
      err?.code ?? 'api_error',
      (ar ? err?.messageAr : err?.message) ?? err?.messageAr ?? fallback,
    );
  }
  return payload as T;
}

/** Show “change dates” in the deposit gate only when check-in is within this window. */
const DEPOSIT_GATE_RESCHEDULE_MS = 24 * 60 * 60 * 1000;

function withinArrivalHours(booking: GuestStayActionBooking, windowMs: number, now = Date.now()) {
  const { checkInAt } = stayArrivalWindow({
    checkInOn: booking.checkInOn,
    checkOutOn: booking.checkOutOn,
    stayType:
      booking.stayType === 'day_use' || booking.stayType === 'overnight_only'
        ? booking.stayType
        : 'overnight_stay',
  });
  return checkInAt.getTime() - now < windowMs;
}

export function GuestStayActions({
  booking,
  compact = false,
  /** Inside the unpaid-deposit arrival modal: pay is separate; change dates only near arrival. */
  depositGate = false,
  onUpdated,
}: {
  booking: GuestStayActionBooking;
  compact?: boolean;
  depositGate?: boolean;
  onUpdated?: (next: GuestStayActionBooking) => void;
}) {
  const locale = useLocale();
  const ar = locale === 'ar';
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'cancel' | 'reschedule' | null>(null);
  const rebookHref = buildRebookHref(locale, booking);
  const paid = PAID_STATUSES.has(booking.status);
  const money = (minor: string) => formatMoney(minor, booking.currency ?? 'OMR', locale);

  function persistAlert(next: GuestStayActionBooking) {
    rememberStayTripAlert({
      id: next.id,
      referenceCode: next.referenceCode,
      status: next.status,
      checkInOn: next.checkInOn,
      checkOutOn: next.checkOutOn,
      ...(next.currency ? { currency: next.currency } : {}),
      ...(next.totalMinor ? { totalMinor: next.totalMinor } : {}),
    });
  }

  function payNow() {
    const reschedulePayUrl = booking.pendingReschedule?.paymentRedirectUrl;
    if (reschedulePayUrl) {
      startTransition(() => {
        setError(null);
        setHint(ar ? 'التحويل إلى بوابة الدفع…' : 'Opening payment…');
        try {
          const target = new URL(reschedulePayUrl, window.location.origin);
          if (
            target.protocol !== 'https:' &&
            !(target.protocol === 'http:' && target.hostname === 'localhost')
          ) {
            throw new Error('invalid_payment_redirect');
          }
          window.location.assign(target.href);
        } catch (caught) {
          setHint(null);
          setError(humanizeBrowserError(caught, ar));
        }
      });
      return;
    }
    if (!booking.paymentIntentId) return;
    startTransition(async () => {
      setError(null);
      setHint(ar ? 'التحويل إلى بوابة الدفع…' : 'Opening payment…');
      try {
        const returnPath = isStayEsignRequiredClient()
          ? stayEsignReturnPath(locale, booking.referenceCode)
          : stayConfirmedReturnPath(locale, booking.referenceCode);
        const session = await browserStayBookingMutation<{ redirectUrl: string }>(
          '/payment-sessions',
          {
            paymentIntentId: booking.paymentIntentId,
            locale: locale === 'en' ? 'en' : 'ar',
            returnPath,
          },
          { idempotencyKey: `guest-pay-${booking.paymentIntentId}` },
        );
        const target = new URL(session.redirectUrl);
        if (
          target.protocol !== 'https:' &&
          !(target.protocol === 'http:' && target.hostname === 'localhost')
        ) {
          throw new Error('invalid_payment_redirect');
        }
        window.location.assign(target.href);
      } catch (caught) {
        setHint(null);
        setError(humanizeBrowserError(caught, ar));
      }
    });
  }

  function cancelBooking() {
    startTransition(async () => {
      setError(null);
      setHint(null);
      try {
        const next = await guestStayPost<GuestStayActionBooking>(
          '/api/public/stays/guest/cancel',
          { referenceCode: booking.referenceCode },
          ar,
          ar ? 'تعذّر إلغاء الحجز.' : 'Could not cancel.',
        );
        persistAlert(next);
        onUpdated?.(next);
        setDialog(null);
        setHint(ar ? 'تم إلغاء الحجز.' : 'Booking cancelled.');
        router.refresh();
      } catch (caught) {
        setDialog(null);
        setError(humanizeBrowserError(caught, ar));
      }
    });
  }

  const showPay = depositGate
    ? false
    : Boolean(
        (booking.canPay && booking.paymentIntentId) ||
        booking.pendingReschedule?.paymentRedirectUrl,
      );
  const showCancel = Boolean(booking.canCancel);
  const pendingReschedule = booking.pendingReschedule ?? null;
  const rescheduleRejection = booking.rescheduleRejection ?? null;
  const rejectionNote = rescheduleRejection?.note
    ? noteForLocale(rescheduleRejection.note, ar ? 'ar' : 'en')
    : null;
  const showModifyDates = Boolean(
    booking.listingSlug &&
    booking.unitId &&
    !pendingReschedule &&
    (booking.canReschedule ?? RESCHEDULABLE.has(booking.status)) &&
    (!depositGate || withinArrivalHours(booking, DEPOSIT_GATE_RESCHEDULE_MS)),
  );
  const showRebook = depositGate
    ? false
    : Boolean(booking.canRebook && rebookHref && !showModifyDates);

  if (
    !showPay &&
    !showCancel &&
    !showRebook &&
    !showModifyDates &&
    !pendingReschedule &&
    !rescheduleRejection
  ) {
    return null;
  }

  return (
    <div
      className={[
        compact || depositGate
          ? 'guest-stay-actions guest-stay-actions--compact'
          : 'guest-stay-actions',
        depositGate ? 'guest-stay-actions--deposit-gate' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {rescheduleRejection && !pendingReschedule ? (
        <p className="notice notice--warn guest-stay-actions__pending" role="status">
          {ar
            ? 'رفض المالك طلب تعديل التواريخ؛ يبقى حجزك على التواريخ الحالية.'
            : 'The host declined your date-change request; your booking stays on the current dates.'}
          {rejectionNote ? (
            <>
              {' '}
              {ar ? 'السبب:' : 'Reason:'} {rejectionNote}
            </>
          ) : null}
        </p>
      ) : null}
      {pendingReschedule ? (
        <p className="notice notice--info guest-stay-actions__pending" role="status">
          {pendingReschedule.status === 'awaiting_owner'
            ? ar
              ? `طلب التعديل إلى ${formatStayRange(pendingReschedule.checkInOn, pendingReschedule.checkOutOn, pendingReschedule.stayType, ar)} · ${stayTypeLabel(pendingReschedule.stayType, 'ar')} بانتظار اعتماد المالك.`
              : `Your request to change to ${formatStayRange(pendingReschedule.checkInOn, pendingReschedule.checkOutOn, pendingReschedule.stayType, ar)} · ${stayTypeLabel(pendingReschedule.stayType, 'en')} is awaiting owner approval.`
            : pendingReschedule.status === 'awaiting_guest_payment'
              ? ar
                ? `اعتمد المالك التعديل — ادفع الفرق (${formatMoney(pendingReschedule.extraDueMinor, booking.currency ?? 'OMR', locale)}) لإتمامه.`
                : `The owner approved the change — pay the difference (${formatMoney(pendingReschedule.extraDueMinor, booking.currency ?? 'OMR', locale)}) to finish.`
              : ar
                ? 'أكمل دفع فرق التعديل لإتمام تغيير التواريخ.'
                : 'Complete the top-up payment to finish the date change.'}
        </p>
      ) : null}
      {showPay ? (
        <button
          type="button"
          className="button button--primary"
          disabled={pending}
          onClick={payNow}
        >
          {pending ? (ar ? 'جارٍ…' : 'Working…') : ar ? 'إتمام الدفع' : 'Complete payment'}
        </button>
      ) : null}
      {showModifyDates ? (
        <button
          type="button"
          className="button guest-stay-actions__modify"
          disabled={pending}
          onClick={() => {
            setError(null);
            setHint(null);
            setDialog('reschedule');
          }}
        >
          {ar ? 'تعديل التواريخ' : 'Change dates'}
        </button>
      ) : null}
      {showRebook ? (
        <Link
          className="button button--primary"
          href={`/stays/${encodeURIComponent(booking.listingSlug!)}/book${(() => {
            const qs = new URLSearchParams();
            if (booking.unitId) qs.set('unit', booking.unitId);
            if (booking.stayType) qs.set('stayType', booking.stayType);
            const q = qs.toString();
            return q ? `?${q}` : '';
          })()}`}
        >
          {ar ? 'احجز مجدداً لنفس العقار' : 'Book again for this stay'}
        </Link>
      ) : null}
      {showCancel ? (
        <button
          type="button"
          className="button guest-stay-actions__cancel"
          disabled={pending}
          onClick={() => {
            setError(null);
            setHint(null);
            setDialog('cancel');
          }}
        >
          {ar ? 'إلغاء الحجز' : 'Cancel booking'}
        </button>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p className="notice notice--info" role="status">
          {hint}
        </p>
      ) : null}

      {dialog === 'cancel' ? (
        <ModalPortal onClose={() => !pending && setDialog(null)}>
          <div
            className="ops-modal guest-stay-dialog guest-stay-dialog--cancel"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !pending) setDialog(null);
            }}
          >
            <section
              className="ops-modal__card"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="guest-cancel-title"
              aria-describedby="guest-cancel-note"
              dir={ar ? 'rtl' : 'ltr'}
            >
              <header>
                <div>
                  <span className="ops-kicker">{booking.referenceCode}</span>
                  <h2 id="guest-cancel-title">{ar ? 'إلغاء الحجز' : 'Cancel booking'}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setDialog(null)}
                  disabled={pending}
                  aria-label={ar ? 'إغلاق' : 'Close'}
                >
                  ×
                </button>
              </header>
              <div className="guest-stay-dialog__body">
                <div id="guest-cancel-note" className="guest-stay-dialog__warning" role="note">
                  <strong>{ar ? 'تنبيه قبل الإلغاء' : 'Before you cancel'}</strong>
                  <p>
                    {ar
                      ? 'المبلغ المدفوع قد لا يُسترد كلياً أو جزئياً، وذلك بحسب سياسة الإلغاء لدى المؤجر.'
                      : 'The amount paid may not be refunded, in full or in part, depending on the landlord’s cancellation policy.'}
                  </p>
                </div>
                <dl className="guest-stay-dialog__facts">
                  <div>
                    <dt>{ar ? 'موعد الإقامة' : 'Stay'}</dt>
                    <dd>
                      {formatStayRange(booking.checkInOn, booking.checkOutOn, booking.stayType, ar)}
                    </dd>
                  </div>
                  {booking.totalMinor ? (
                    <div>
                      <dt>
                        {paid
                          ? ar
                            ? 'المبلغ المدفوع'
                            : 'Amount paid'
                          : ar
                            ? 'إجمالي الحجز'
                            : 'Booking total'}
                      </dt>
                      <dd>{money(booking.totalMinor)}</dd>
                    </div>
                  ) : null}
                </dl>
                {!paid ? (
                  <p className="muted">
                    {ar
                      ? 'لم يُسجَّل دفع لهذا الحجز بعد، وستُتاح التواريخ لغيرك فور الإلغاء.'
                      : 'No payment has been recorded yet; the dates are released as soon as you cancel.'}
                  </p>
                ) : null}
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setDialog(null)}
                  disabled={pending}
                >
                  {ar ? 'تراجع' : 'Keep booking'}
                </button>
                <button
                  type="button"
                  className="button button--danger"
                  onClick={cancelBooking}
                  disabled={pending}
                >
                  {pending
                    ? ar
                      ? 'جارٍ الإلغاء…'
                      : 'Cancelling…'
                    : ar
                      ? 'تأكيد الإلغاء'
                      : 'Confirm cancellation'}
                </button>
              </div>
            </section>
          </div>
        </ModalPortal>
      ) : null}

      {dialog === 'reschedule' && booking.listingSlug && booking.unitId ? (
        <RescheduleDialog
          booking={booking}
          slug={booking.listingSlug}
          unitId={booking.unitId}
          locale={locale}
          onClose={() => setDialog(null)}
          onDone={(next, meta) => {
            persistAlert(next);
            onUpdated?.(next);
            setDialog(null);
            setHint(
              meta?.awaitingOwnerApproval
                ? ar
                  ? 'أُرسل طلب التعديل للمالك — بانتظار اعتماده.'
                  : 'Change request sent to the owner — awaiting approval.'
                : ar
                  ? 'تم تعديل الحجز.'
                  : 'Booking updated.',
            );
            window.dispatchEvent(new Event(LIVE_CHANGE_EVENT));
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function RescheduleDialog({
  booking,
  slug,
  unitId,
  locale,
  onClose,
  onDone,
}: {
  booking: GuestStayActionBooking;
  slug: string;
  unitId: string;
  locale: string;
  onClose: () => void;
  onDone: (next: GuestStayActionBooking, meta?: { awaitingOwnerApproval?: boolean }) => void;
}) {
  const ar = locale === 'ar';
  const currentType = normalizeStayType(booking.stayType);
  const [mode, setMode] = useState<RescheduleMode | null>(null);
  const [stayType, setStayType] = useState<StayTypeOption>(currentType);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [quote, setQuote] = useState<RescheduleQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [saving, startSaving] = useTransition();
  const [monthCount, setMonthCount] = useState<1 | 2>(1);
  const ownRange = useMemo(
    () => ({ checkInOn: booking.checkInOn, checkOutOn: booking.checkOutOn }),
    [booking.checkInOn, booking.checkOutOn],
  );
  const money = (minor: string) =>
    formatMoney(minor, quote?.currency ?? booking.currency ?? 'OMR', locale);

  const needsDates = mode === 'dates' || mode === 'both';
  const needsPeriod = mode === 'period' || mode === 'both';
  const halfDay = isHalfDayStay(stayType);
  const effectiveCheckIn = needsDates ? checkIn : booking.checkInOn;
  const effectiveCheckOut = needsDates
    ? halfDay
      ? checkIn
      : checkOut
    : halfDay
      ? booking.checkInOn
      : booking.checkOutOn;

  useEffect(() => {
    const query = window.matchMedia('(min-width: 720px)');
    const sync = () => setMonthCount(query.matches ? 2 : 1);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!mode) return;
    setStayType(currentType);
    if (mode === 'period') {
      setCheckIn(booking.checkInOn);
      setCheckOut(booking.checkOutOn);
    } else {
      setCheckIn('');
      setCheckOut('');
    }
    setQuote(null);
    setQuoteError(null);
  }, [mode, booking.checkInOn, booking.checkOutOn, currentType]);

  const rangeReady = Boolean(
    mode &&
    effectiveCheckIn &&
    (halfDay || (effectiveCheckOut && effectiveCheckOut > effectiveCheckIn)),
  );
  const selectionChanged = Boolean(
    mode &&
    (effectiveCheckIn !== booking.checkInOn ||
      effectiveCheckOut !== booking.checkOutOn ||
      stayType !== currentType),
  );

  useEffect(() => {
    if (!mode || !rangeReady || !selectionChanged) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    setQuoteError(null);
    setQuote(null);
    guestStayPost<{ quote: RescheduleQuote }>(
      '/api/public/stays/guest/reschedule',
      {
        referenceCode: booking.referenceCode,
        checkInOn: effectiveCheckIn,
        checkOutOn: halfDay ? effectiveCheckIn : effectiveCheckOut,
        stayType,
        confirm: false,
        locale: ar ? 'ar' : 'en',
      },
      ar,
      ar ? 'تعذّر حساب سعر التعديل.' : 'Could not price the change.',
    )
      .then((payload) => {
        if (!cancelled) setQuote(payload.quote);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setQuoteError(humanizeBrowserError(caught, ar));
      })
      .finally(() => {
        if (!cancelled) setQuoting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    ar,
    booking.referenceCode,
    effectiveCheckIn,
    effectiveCheckOut,
    halfDay,
    mode,
    rangeReady,
    selectionChanged,
    stayType,
  ]);

  function confirmMove() {
    if (!quote || !mode) return;
    // Confirm the priced quote only — never a newer local selection that raced the quote.
    const confirmIn = quote.checkInOn;
    const confirmOut = isHalfDayStay(quote.stayType) ? quote.checkInOn : quote.checkOutOn;
    const confirmType = quote.stayType;
    startSaving(async () => {
      setQuoteError(null);
      try {
        const payload = await guestStayPost<{
          booking?: GuestStayActionBooking;
          payment?: { redirectUrl: string };
          awaitingOwnerApproval?: boolean;
        }>(
          '/api/public/stays/guest/reschedule',
          {
            referenceCode: booking.referenceCode,
            checkInOn: confirmIn,
            checkOutOn: confirmOut,
            stayType: confirmType,
            confirm: true,
            locale: ar ? 'ar' : 'en',
          },
          ar,
          ar ? 'تعذّر تعديل الحجز.' : 'Could not change the booking.',
        );
        if (payload.payment?.redirectUrl) {
          const target = new URL(payload.payment.redirectUrl, window.location.origin);
          if (
            target.protocol !== 'https:' &&
            !(target.protocol === 'http:' && target.hostname === 'localhost')
          ) {
            throw new Error('invalid_payment_redirect');
          }
          window.location.assign(target.href);
          return;
        }
        if (payload.booking) {
          onDone(payload.booking, {
            awaitingOwnerApproval: Boolean(payload.awaitingOwnerApproval),
          });
        }
      } catch (caught) {
        setQuoteError(humanizeBrowserError(caught, ar));
      }
    });
  }

  const busy = saving || quoting;
  const confirmLabel = quote?.requiresPayment
    ? ar
      ? `ادفع الفرق ${money(quote.extraDueMinor)}`
      : `Pay difference ${money(quote.extraDueMinor)}`
    : ar
      ? 'تأكيد التعديل'
      : 'Confirm change';

  return (
    <ModalPortal onClose={() => !saving && onClose()}>
      <div
        className="ops-modal ops-modal--create guest-stay-dialog guest-stay-dialog--reschedule"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) onClose();
        }}
      >
        <section
          className="ops-modal__card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="guest-reschedule-title"
          dir={ar ? 'rtl' : 'ltr'}
        >
          <header>
            <div>
              <span className="ops-kicker">{booking.referenceCode}</span>
              <h2 id="guest-reschedule-title">{ar ? 'تعديل الحجز' : 'Change booking'}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label={ar ? 'إغلاق' : 'Close'}
            >
              ×
            </button>
          </header>
          <div className="guest-stay-dialog__body">
            <p className="guest-stay-dialog__current">
              <span>{ar ? 'حجزك الحالي' : 'Current booking'}</span>
              <strong>
                {formatStayRange(booking.checkInOn, booking.checkOutOn, currentType, ar)}
                <small>
                  {' '}
                  · {stayTypeLabel(currentType, ar ? 'ar' : 'en')} · {periodSpanLabel(currentType)}
                </small>
              </strong>
              {booking.totalMinor ? <em>{money(booking.totalMinor)}</em> : null}
            </p>

            <fieldset className="guest-stay-dialog__modes">
              <legend>{ar ? 'ماذا تريد تغييره؟' : 'What do you want to change?'}</legend>
              <div className="guest-stay-dialog__mode-grid" role="radiogroup">
                {(
                  [
                    {
                      id: 'period' as const,
                      title: ar ? 'الفترة فقط' : 'Period only',
                      hint: ar
                        ? 'نفس التاريخ — بدّل نوع الإقامة (صباحي / مبيت / كامل).'
                        : 'Same dates — switch stay period (day use / overnight / full).',
                    },
                    {
                      id: 'dates' as const,
                      title: ar ? 'التاريخ فقط' : 'Dates only',
                      hint: ar
                        ? 'نفس نوع الإقامة — اختر أياماً أخرى.'
                        : 'Same stay type — pick different days.',
                    },
                    {
                      id: 'both' as const,
                      title: ar ? 'التاريخ والفترة' : 'Dates and period',
                      hint: ar
                        ? 'غيّر الأيام ونوع الإقامة معاً.'
                        : 'Change both the days and the stay type.',
                    },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === option.id}
                    className={`guest-stay-dialog__mode${mode === option.id ? ' is-selected' : ''}`}
                    onClick={() => setMode(option.id)}
                    disabled={saving}
                  >
                    <strong>{option.title}</strong>
                    <span>{option.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {needsPeriod ? (
              <fieldset className="guest-stay-dialog__period">
                <legend>{ar ? 'نوع الإقامة الجديد' : 'New stay type'}</legend>
                <div className="guest-stay-dialog__period-grid">
                  {STAY_TYPE_OPTIONS.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className={`guest-stay-dialog__period-btn${stayType === type ? ' is-selected' : ''}`}
                      aria-pressed={stayType === type}
                      onClick={() => {
                        setQuote(null);
                        setQuoteError(null);
                        setStayType(type);
                        if (isHalfDayStay(type) && checkIn) {
                          setCheckOut(checkIn);
                        }
                      }}
                      disabled={saving || (mode === 'period' && type === currentType)}
                    >
                      {stayTypeLabel(type, ar ? 'ar' : 'en')}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {needsDates ? (
              <>
                <p className="muted guest-stay-dialog__hint">
                  {halfDay
                    ? ar
                      ? 'اختر يوماً شاغراً. الأيام المحجوزة أو المغلقة غير قابلة للاختيار.'
                      : 'Pick a free day. Booked or closed days cannot be selected.'
                    : ar
                      ? 'اختر يوم الوصول ثم يوم المغادرة من الأيام الشاغرة فقط.'
                      : 'Pick arrival then departure from free days only.'}
                </p>
                <div className="guest-stay-dialog__calendar">
                  <StayAvailabilityCalendar
                    locale={locale}
                    mode="public"
                    slug={slug}
                    unitId={unitId}
                    monthCount={monthCount}
                    size="compact"
                    selectedCheckIn={checkIn}
                    selectedCheckOut={halfDay ? '' : checkOut}
                    ownRange={ownRange}
                    onRangeChange={(nextIn, nextOut, halfDayHint) => {
                      setQuote(null);
                      setQuoteError(null);
                      if (halfDayHint) {
                        setStayType(halfDayHint);
                        setCheckIn(nextIn);
                        setCheckOut(nextIn);
                        return;
                      }
                      if (isHalfDayStay(stayType)) {
                        setCheckIn(nextIn);
                        setCheckOut(nextIn);
                        return;
                      }
                      setCheckIn(nextIn);
                      setCheckOut(nextOut > nextIn ? nextOut : '');
                    }}
                  />
                </div>
              </>
            ) : null}

            <div className="guest-stay-dialog__quote" aria-live="polite">
              {!mode ? (
                <p className="muted">
                  {ar ? 'اختر نوع التعديل أولاً.' : 'Choose what to change first.'}
                </p>
              ) : needsDates && !rangeReady ? (
                <p className="muted">
                  {ar
                    ? 'اختر التواريخ الجديدة لعرض السعر.'
                    : 'Pick the new dates to see the price.'}
                </p>
              ) : needsPeriod && !selectionChanged ? (
                <p className="muted">
                  {ar
                    ? 'اختر نوع إقامة مختلفاً عن حجزك الحالي.'
                    : 'Pick a stay type different from your current booking.'}
                </p>
              ) : quoting ? (
                <p className="muted">{ar ? 'جارٍ حساب السعر…' : 'Pricing…'}</p>
              ) : quote ? (
                <>
                  <dl className="guest-stay-dialog__facts">
                    <div>
                      <dt>{ar ? 'بعد التعديل' : 'After change'}</dt>
                      <dd>
                        {formatStayRange(quote.checkInOn, quote.checkOutOn, quote.stayType, ar)}
                        <small>
                          {' '}
                          · {stayTypeLabel(quote.stayType, ar ? 'ar' : 'en')} ·{' '}
                          {periodSpanLabel(quote.stayType)}
                          {!isHalfDayStay(quote.stayType) && quote.nights > 0
                            ? ` · ${nightsText(quote.nights, ar)}`
                            : ''}
                        </small>
                      </dd>
                    </div>
                    <div>
                      <dt>{ar ? 'سعر الخيار الجديد' : 'New option price'}</dt>
                      <dd>{money(quote.quotedTotalMinor)}</dd>
                    </div>
                    <div className="guest-stay-dialog__total">
                      <dt>{ar ? 'المبلغ المعتمد بعد التعديل' : 'Amount after the change'}</dt>
                      <dd>{money(quote.chargedTotalMinor)}</dd>
                    </div>
                  </dl>
                  {quote.keptOriginalPrice ? (
                    <div className="guest-stay-dialog__warning" role="note">
                      <strong>
                        {ar
                          ? 'السعر الجديد أقل من المدفوع'
                          : 'New price is lower than what you paid'}
                      </strong>
                      <p>
                        {ar
                          ? `لا يُسترد الفرق (${money(quote.forfeitedMinor)}). يبقى حجزك بنفس المبلغ المدفوع ${money(quote.originalTotalMinor)}. لا يمكن تخفيض الفترة لاسترداد جزء من المبلغ.`
                          : `The difference (${money(quote.forfeitedMinor)}) is not refunded. Your booking keeps the paid amount of ${money(quote.originalTotalMinor)}. A cheaper period cannot reduce what you already paid.`}
                      </p>
                    </div>
                  ) : null}
                  {quote.requiresPayment ? (
                    <p className="notice notice--info" role="status">
                      {ar
                        ? `الخيار الجديد أعلى بـ ${money(quote.extraDueMinor)}. ادفع الفرق لإتمام التعديل.`
                        : `The new option costs ${money(quote.extraDueMinor)} more. Pay the difference to apply the change.`}
                    </p>
                  ) : quote.extraDueMinor !== '0' ? (
                    <p className="notice notice--info">
                      {ar
                        ? `السعر أعلى بـ ${money(quote.extraDueMinor)}، وسيصبح إجمالي الحجز ${money(quote.chargedTotalMinor)}.`
                        : `The new option costs ${money(quote.extraDueMinor)} more; the booking total becomes ${money(quote.chargedTotalMinor)}.`}
                    </p>
                  ) : null}
                  {booking.status === 'request_pending' ? (
                    <p className="muted">
                      {ar
                        ? 'يبقى طلبك بانتظار اعتماد المالك بالخيار الجديد.'
                        : 'Your request stays with the owner for approval on the new option.'}
                    </p>
                  ) : null}
                </>
              ) : null}
              {quoteError ? (
                <p className="notice notice--error" role="alert">
                  {quoteError}
                </p>
              ) : null}
            </div>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                if (mode && !saving) {
                  setMode(null);
                  setQuote(null);
                  setQuoteError(null);
                  return;
                }
                onClose();
              }}
              disabled={saving}
            >
              {mode ? (ar ? 'رجوع' : 'Back') : ar ? 'تراجع' : 'Cancel'}
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={confirmMove}
              disabled={busy || !quote}
            >
              {saving
                ? quote?.requiresPayment
                  ? ar
                    ? 'جارٍ التحويل للدفع…'
                    : 'Opening payment…'
                  : ar
                    ? 'جارٍ الحفظ…'
                    : 'Saving…'
                : confirmLabel}
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
