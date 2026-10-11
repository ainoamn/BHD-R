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
};

type RescheduleQuote = {
  currency: string;
  checkInOn: string;
  checkOutOn: string;
  nights: number;
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

export function GuestStayActions({
  booking,
  compact = false,
  onUpdated,
}: {
  booking: GuestStayActionBooking;
  compact?: boolean;
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

  const showPay = Boolean(booking.canPay && booking.paymentIntentId);
  const showCancel = Boolean(booking.canCancel);
  const showModifyDates = Boolean(
    booking.listingSlug &&
    booking.unitId &&
    (booking.canReschedule ?? RESCHEDULABLE.has(booking.status)),
  );
  const showRebook = Boolean(booking.canRebook && rebookHref && !showModifyDates);

  if (!showPay && !showCancel && !showRebook && !showModifyDates) {
    return null;
  }

  return (
    <div
      className={compact ? 'guest-stay-actions guest-stay-actions--compact' : 'guest-stay-actions'}
    >
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
          className="button"
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
          className="button button--quiet"
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
                      {formatDay(booking.checkInOn, ar)} — {formatDay(booking.checkOutOn, ar)}
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
          onDone={(next) => {
            persistAlert(next);
            onUpdated?.(next);
            setDialog(null);
            setHint(ar ? 'تم تعديل تواريخ الحجز.' : 'Booking dates updated.');
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
  onDone: (next: GuestStayActionBooking) => void;
}) {
  const ar = locale === 'ar';
  const halfDay = booking.stayType === 'day_use' || booking.stayType === 'overnight_only';
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

  useEffect(() => {
    const query = window.matchMedia('(min-width: 900px)');
    const sync = () => setMonthCount(query.matches ? 2 : 1);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const rangeReady = Boolean(checkIn && (halfDay || (checkOut && checkOut > checkIn)));

  useEffect(() => {
    if (!rangeReady) {
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
        checkInOn: checkIn,
        checkOutOn: halfDay ? checkIn : checkOut,
        confirm: false,
      },
      ar,
      ar ? 'تعذّر حساب سعر التواريخ الجديدة.' : 'Could not price the new dates.',
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
  }, [ar, booking.referenceCode, checkIn, checkOut, halfDay, rangeReady]);

  function confirmMove() {
    if (!quote || quote.requiresPayment) return;
    startSaving(async () => {
      setQuoteError(null);
      try {
        const payload = await guestStayPost<{ booking: GuestStayActionBooking }>(
          '/api/public/stays/guest/reschedule',
          {
            referenceCode: booking.referenceCode,
            checkInOn: checkIn,
            checkOutOn: halfDay ? checkIn : checkOut,
            confirm: true,
          },
          ar,
          ar ? 'تعذّر تعديل التواريخ.' : 'Could not change the dates.',
        );
        onDone(payload.booking);
      } catch (caught) {
        setQuoteError(humanizeBrowserError(caught, ar));
      }
    });
  }

  const busy = saving || quoting;

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
              <h2 id="guest-reschedule-title">{ar ? 'تعديل التواريخ' : 'Change dates'}</h2>
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
              <span>{ar ? 'موعدك الحالي' : 'Current stay'}</span>
              <strong>
                {formatDay(booking.checkInOn, ar)} — {formatDay(booking.checkOutOn, ar)}
              </strong>
              {booking.totalMinor ? <em>{money(booking.totalMinor)}</em> : null}
            </p>
            <p className="muted guest-stay-dialog__hint">
              {halfDay
                ? ar
                  ? 'اختر يوماً شاغراً. الأيام المحجوزة أو المغلقة غير قابلة للاختيار، والسعر الظاهر هو سعر اليوم.'
                  : 'Pick a free day. Booked or closed days cannot be selected; the price shown is the day rate.'
                : ar
                  ? 'اختر يوم الوصول ثم يوم المغادرة من الأيام الشاغرة فقط. السعر الظاهر على كل يوم هو سعر الليلة.'
                  : 'Pick arrival then departure from free days only. The price on each day is the nightly rate.'}
            </p>
            <StayAvailabilityCalendar
              locale={locale}
              mode="public"
              slug={slug}
              unitId={unitId}
              monthCount={monthCount}
              size="large"
              selectedCheckIn={checkIn}
              selectedCheckOut={halfDay ? '' : checkOut}
              ownRange={ownRange}
              onRangeChange={(nextIn, nextOut) => {
                setCheckIn(nextIn);
                setCheckOut(nextOut > nextIn ? nextOut : '');
              }}
            />

            <div className="guest-stay-dialog__quote" aria-live="polite">
              {!rangeReady ? (
                <p className="muted">
                  {ar
                    ? 'اختر التواريخ الجديدة لعرض السعر.'
                    : 'Pick the new dates to see the price.'}
                </p>
              ) : quoting ? (
                <p className="muted">{ar ? 'جارٍ حساب السعر…' : 'Pricing…'}</p>
              ) : quote ? (
                <>
                  <dl className="guest-stay-dialog__facts">
                    <div>
                      <dt>{ar ? 'التواريخ الجديدة' : 'New dates'}</dt>
                      <dd>
                        {formatDay(quote.checkInOn, ar)} — {formatDay(quote.checkOutOn, ar)}
                        <small>{nightsText(quote.nights, ar)}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        {ar ? 'سعر التواريخ الجديدة (حسب التقويم)' : 'Calendar price for new dates'}
                      </dt>
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
                        {quote.hasOffer
                          ? ar
                            ? 'هذه الأيام عليها عرض'
                            : 'These days are on offer'
                          : ar
                            ? 'سعر التواريخ الجديدة أقل'
                            : 'The new dates cost less'}
                      </strong>
                      <p>
                        {ar
                          ? `لن يُسترد فرق السعر (${money(quote.forfeitedMinor)})، وتبقى المحاسبة على سعر حجزك الأصلي ${money(quote.originalTotalMinor)}.`
                          : `The difference (${money(quote.forfeitedMinor)}) is not refunded; you are charged your original booking price of ${money(quote.originalTotalMinor)}.`}
                      </p>
                    </div>
                  ) : null}
                  {quote.requiresPayment ? (
                    <p className="notice notice--error" role="alert">
                      {ar
                        ? `سعر التواريخ الجديدة أعلى من المبلغ المدفوع بـ ${money(quote.extraDueMinor)}. لا يمكن دفع الفرق إلكترونياً حالياً — اختر تواريخ أخرى أو تواصل مع المالك.`
                        : `The new dates cost ${money(quote.extraDueMinor)} more than you paid. The difference cannot be paid online yet — pick other dates or contact the owner.`}
                    </p>
                  ) : quote.extraDueMinor !== '0' ? (
                    <p className="notice notice--info">
                      {ar
                        ? `سعر التواريخ الجديدة أعلى بـ ${money(quote.extraDueMinor)}، وسيصبح إجمالي الحجز ${money(quote.chargedTotalMinor)}.`
                        : `The new dates cost ${money(quote.extraDueMinor)} more; the booking total becomes ${money(quote.chargedTotalMinor)}.`}
                    </p>
                  ) : null}
                  {booking.status === 'request_pending' ? (
                    <p className="muted">
                      {ar
                        ? 'يبقى طلبك بانتظار اعتماد المالك بالتواريخ الجديدة.'
                        : 'Your request stays with the owner for approval on the new dates.'}
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
              onClick={onClose}
              disabled={saving}
            >
              {ar ? 'تراجع' : 'Back'}
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={confirmMove}
              disabled={busy || !quote || quote.requiresPayment}
            >
              {saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'تأكيد التعديل' : 'Confirm change'}
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
