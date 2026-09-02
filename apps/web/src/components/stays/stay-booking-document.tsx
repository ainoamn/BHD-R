import type { ReactNode } from 'react';
import { formatMoney } from '@/lib/format';

export type StayBookingDocumentData = {
  referenceCode: string;
  status: string;
  checkInOn?: string;
  checkOutOn?: string;
  currency?: string;
  totalMinor?: string;
  nights?: number | null;
  guestDisplayName?: string | null;
  guestEmail?: string | null;
  adults?: number | null;
  children?: number | null;
  stayType?: string | null;
};

export type StayBookingDocumentKind = 'payment' | 'confirmation';

function stayTypeLabel(type: string | null | undefined, ar: boolean): string {
  if (type === 'day_use') return ar ? 'إقامة بدون مبيت' : 'Day use';
  if (type === 'overnight_only') return ar ? 'مبيت فقط' : 'Overnight only';
  if (type === 'overnight_stay') return ar ? 'إقامة مع مبيت' : 'Stay with overnight';
  return type ?? '—';
}

function statusLabel(status: string, paid: boolean, ar: boolean): string {
  if (status === 'payment_pending' || status === 'request_pending') {
    return ar ? 'بانتظار الدفع' : 'Awaiting payment';
  }
  if (paid) return ar ? 'مؤكّد / مدفوع' : 'Confirmed / paid';
  return status;
}

function Row({ label, value, ltr }: { label: string; value: ReactNode; ltr?: boolean }) {
  return (
    <div className="stay-doc__row">
      <dt>{label}</dt>
      <dd dir={ltr ? 'ltr' : undefined}>{value}</dd>
    </div>
  );
}

export function StayBookingDocument({
  kind,
  booking,
  locale,
}: {
  kind: StayBookingDocumentKind;
  booking: StayBookingDocumentData;
  locale: string;
}) {
  const ar = locale === 'ar';
  const paid = booking.status === 'confirmed' || booking.status === 'paid';
  const title =
    kind === 'payment'
      ? ar
        ? 'إيصال دفع'
        : 'Payment receipt'
      : ar
        ? 'تأكيد حجز'
        : 'Booking confirmation';
  const subtitle =
    kind === 'payment'
      ? ar
        ? 'مستند رسمي لاستلام مبلغ حجز إقامة يومية.'
        : 'Official record of stay booking payment.'
      : ar
        ? 'مستند رسمي لتأكيد تفاصيل حجز الإقامة.'
        : 'Official confirmation of stay booking details.';
  const amountLabel =
    booking.totalMinor && booking.currency
      ? formatMoney(booking.totalMinor, booking.currency, locale)
      : null;
  const issuedOn = new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());

  return (
    <article className="stay-doc" id="stay-receipt" data-doc-kind={kind}>
      <header className="stay-doc__header">
        <div className="stay-doc__brand">
          <span className="stay-doc__logo logo__product" aria-label="BHD R">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bhd-official-symbol.svg" alt="" width="88" height="28" />
            <i>R</i>
          </span>
          <p className="stay-doc__tagline">{ar ? 'منتج من منظومة BHD' : 'A BHD Product · Oman'}</p>
        </div>
        <div className="stay-doc__meta">
          <p className="stay-doc__kind">{title}</p>
          <p className="stay-doc__number" dir="ltr">
            {booking.referenceCode}
          </p>
          <p className="stay-doc__issued">
            {ar ? 'تاريخ الإصدار' : 'Issued'} · {issuedOn}
          </p>
        </div>
      </header>

      <p className="stay-doc__subtitle">{subtitle}</p>

      <div className="stay-doc__badge" data-paid={paid ? 'true' : 'false'}>
        {statusLabel(booking.status, paid, ar)}
      </div>

      <dl className="stay-doc__grid">
        {booking.guestDisplayName ? (
          <Row label={ar ? 'الضيف' : 'Guest'} value={booking.guestDisplayName} />
        ) : null}
        {booking.guestEmail ? (
          <Row label={ar ? 'البريد' : 'Email'} value={booking.guestEmail} ltr />
        ) : null}
        {booking.checkInOn ? (
          <Row label={ar ? 'الوصول' : 'Check-in'} value={booking.checkInOn} ltr />
        ) : null}
        {booking.checkOutOn ? (
          <Row label={ar ? 'المغادرة' : 'Check-out'} value={booking.checkOutOn} ltr />
        ) : null}
        {typeof booking.nights === 'number' ? (
          <Row
            label={ar ? 'عدد الليالي' : 'Nights'}
            value={`${booking.nights} ${
              ar
                ? booking.nights === 1
                  ? 'ليلة'
                  : 'ليالٍ'
                : booking.nights === 1
                  ? 'night'
                  : 'nights'
            }`}
          />
        ) : null}
        {booking.stayType ? (
          <Row label={ar ? 'نوع الحجز' : 'Stay type'} value={stayTypeLabel(booking.stayType, ar)} />
        ) : null}
        {typeof booking.adults === 'number' ? (
          <Row label={ar ? 'بالغون' : 'Adults'} value={String(booking.adults)} />
        ) : null}
        {typeof booking.children === 'number' ? (
          <Row label={ar ? 'أطفال' : 'Children'} value={String(booking.children)} />
        ) : null}
      </dl>

      {amountLabel ? (
        <div className="stay-doc__total">
          <span>
            {kind === 'payment'
              ? ar
                ? 'المبلغ المستلم'
                : 'Amount received'
              : ar
                ? 'إجمالي الحجز'
                : 'Booking total'}
          </span>
          <strong dir="ltr">{amountLabel}</strong>
        </div>
      ) : null}

      <footer className="stay-doc__footer">
        <p>
          {kind === 'payment'
            ? ar
              ? 'يُعدّ هذا المستند إيصالاً مالياً لعملية الدفع المرتبطة برقم الحجز أعلاه.'
              : 'This document is a financial receipt for the payment linked to the booking reference above.'
            : ar
              ? 'يُعدّ هذا المستند تأكيداً رسمياً لتفاصيل الحجز. يُرجى الاحتفاظ به ليوم الوصول.'
              : 'This document is an official confirmation of the booking details. Please keep it for check-in.'}
        </p>
        <p className="stay-doc__thanks">
          {ar ? 'شكراً لاختياركم BHD R' : 'Thank you for choosing BHD R'}
        </p>
      </footer>
    </article>
  );
}
