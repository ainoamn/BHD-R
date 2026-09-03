'use client';

import { useState, useTransition } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  ApiError,
  browserStayBookingMutation,
  humanizeBrowserError,
} from '@/lib/api';
import { rememberStayTripAlert } from '@/lib/stay-trip-alerts';

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
};

function buildRebookHref(
  locale: string,
  booking: GuestStayActionBooking,
): string | null {
  if (!booking.listingSlug) return null;
  const qs = new URLSearchParams();
  if (booking.unitId) qs.set('unit', booking.unitId);
  if (booking.stayType) qs.set('stayType', booking.stayType);
  const q = qs.toString();
  return `/${locale}/stays/${encodeURIComponent(booking.listingSlug)}/book${q ? `?${q}` : ''}`;
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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const rebookHref = buildRebookHref(locale, booking);

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
        const esignOn = process.env.NEXT_PUBLIC_STAY_ESIGN_REQUIRED !== '0';
        const returnPath = esignOn
          ? `/${locale}/stays/booking/sign?ref=${encodeURIComponent(booking.referenceCode)}`
          : `/${locale}/stays/booking/confirmed?ref=${encodeURIComponent(booking.referenceCode)}`;
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

  function cancelBooking(thenRebook = false) {
    if (
      !window.confirm(
        ar
          ? thenRebook
            ? 'سيتم إلغاء هذا الحجز ثم فتح صفحة اختيار تواريخ جديدة. متابعة؟'
            : 'هل تريد إلغاء هذا الحجز؟'
          : thenRebook
            ? 'This booking will be cancelled, then you can pick new dates. Continue?'
            : 'Cancel this booking?',
      )
    ) {
      return;
    }
    startTransition(async () => {
      setError(null);
      setHint(null);
      try {
        const response = await fetch('/api/public/stays/guest/cancel', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-requested-with': 'BHD-R',
          },
          body: JSON.stringify({ referenceCode: booking.referenceCode }),
          signal: AbortSignal.timeout(30_000),
        });
        const payload = (await response.json().catch(() => null)) as
          | GuestStayActionBooking
          | { error?: { code?: string; messageAr?: string; message?: string } }
          | null;
        if (!response.ok) {
          const err = payload && 'error' in payload ? payload.error : null;
          throw new ApiError(
            response.status,
            err?.code ?? 'api_error',
            err?.messageAr ?? err?.message ?? (ar ? 'تعذّر إلغاء الحجز.' : 'Could not cancel.'),
          );
        }
        const next = payload as GuestStayActionBooking;
        persistAlert(next);
        onUpdated?.(next);
        if (thenRebook && rebookHref) {
          window.location.assign(rebookHref);
          return;
        }
        setHint(ar ? 'تم إلغاء الحجز.' : 'Booking cancelled.');
      } catch (caught) {
        setError(humanizeBrowserError(caught, ar));
      }
    });
  }

  const showPay = Boolean(booking.canPay && booking.paymentIntentId);
  const showCancel = Boolean(booking.canCancel);
  const showRebook = Boolean(booking.canRebook && rebookHref);
  const showModifyDates = Boolean(
    rebookHref &&
      (booking.status === 'payment_pending' ||
        booking.status === 'payment_failed' ||
        booking.status === 'request_pending'),
  );

  if (!showPay && !showCancel && !showRebook && !showModifyDates) {
    return null;
  }

  return (
    <div className={compact ? 'guest-stay-actions guest-stay-actions--compact' : 'guest-stay-actions'}>
      {showPay ? (
        <button
          type="button"
          className="button button--primary"
          disabled={pending}
          onClick={payNow}
        >
          {pending
            ? ar
              ? 'جارٍ…'
              : 'Working…'
            : ar
              ? 'إتمام الدفع'
              : 'Complete payment'}
        </button>
      ) : null}
      {showModifyDates ? (
        <button
          type="button"
          className="button"
          disabled={pending}
          onClick={() => cancelBooking(true)}
        >
          {ar ? 'تعديل التواريخ' : 'Change dates'}
        </button>
      ) : null}
      {showRebook && !showModifyDates ? (
        <Link
          className="button button--primary"
          href={`/stays/${encodeURIComponent(booking.listingSlug!)}/book${
            (() => {
              const qs = new URLSearchParams();
              if (booking.unitId) qs.set('unit', booking.unitId);
              if (booking.stayType) qs.set('stayType', booking.stayType);
              const q = qs.toString();
              return q ? `?${q}` : '';
            })()
          }`}
        >
          {ar ? 'احجز مجدداً لنفس العقار' : 'Book again for this stay'}
        </Link>
      ) : null}
      {showCancel ? (
        <button
          type="button"
          className="button button--quiet"
          disabled={pending}
          onClick={() => cancelBooking(false)}
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
    </div>
  );
}
