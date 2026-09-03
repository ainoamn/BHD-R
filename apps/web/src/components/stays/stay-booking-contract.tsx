import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import {
  stayBookingModeLabel,
  stayStatusLabel,
  stayTypeLabel,
} from '@/lib/ui-labels';

export type StayBookingContractData = {
  id: string;
  referenceCode: string;
  status: string;
  bookingMode: string;
  source?: string;
  checkInOn: string;
  checkOutOn: string;
  nights: number;
  currency: string;
  totalMinor: string;
  createdAt: string;
  guestDisplayName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  adults?: number | null;
  children?: number | null;
  stayType?: string | null;
  propertyId: string;
  propertyNameAr?: string | null;
  propertyNameEn?: string | null;
  unitId: string;
  unitCode?: string | null;
  unitNameAr?: string | null;
  unitNameEn?: string | null;
  paymentStatus: string;
  paymentMethod: string;
  paymentProviderRef?: string | null;
  paidAt?: string | null;
  paidAmountMinor?: string | null;
  paidCurrency?: string | null;
};

function Row({ label, value, ltr }: { label: string; value: ReactNode; ltr?: boolean }) {
  return (
    <div className="stay-doc__row">
      <dt>{label}</dt>
      <dd dir={ltr ? 'ltr' : undefined}>{value}</dd>
    </div>
  );
}

function paymentMethodCopy(method: string, ar: boolean): string {
  switch (method) {
    case 'sandbox_card':
      return ar ? 'بطاقة تجريبية (Sandbox)' : 'Sandbox card';
    case 'card':
      return ar ? 'بطاقة بنكية' : 'Bank card';
    case 'pending':
      return ar ? 'لم يتم الدفع بعد' : 'Payment not completed';
    default:
      return method;
  }
}

function paymentStatusCopy(status: string, ar: boolean): string {
  switch (status) {
    case 'succeeded':
      return ar ? 'مدفوع' : 'Paid';
    case 'pending':
      return ar ? 'بانتظار الدفع' : 'Awaiting payment';
    case 'failed':
      return ar ? 'فشل الدفع' : 'Payment failed';
    case 'cancelled':
      return ar ? 'ملغى' : 'Cancelled';
    default:
      return status;
  }
}

export function StayBookingContract({
  booking,
  locale,
  portal,
}: {
  booking: StayBookingContractData;
  locale: string;
  portal: 'owner' | 'developer';
}) {
  const ar = locale === 'ar';
  const paid =
    booking.status === 'confirmed' ||
    booking.status === 'paid' ||
    booking.paymentStatus === 'succeeded';
  const propertyName = ar
    ? booking.propertyNameAr || booking.propertyNameEn
    : booking.propertyNameEn || booking.propertyNameAr;
  const unitLabel =
    (ar
      ? booking.unitNameAr || booking.unitNameEn
      : booking.unitNameEn || booking.unitNameAr) ||
    booking.unitCode ||
    '—';
  const amountLabel = formatMoney(booking.totalMinor, booking.currency, locale);
  const paidAmountLabel =
    booking.paidAmountMinor && booking.paidCurrency
      ? formatMoney(booking.paidAmountMinor, booking.paidCurrency, locale)
      : amountLabel;
  const issuedOn = new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(booking.createdAt));
  const paidOn = booking.paidAt
    ? new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(booking.paidAt))
    : null;

  return (
    <article className="stay-doc stay-doc--contract" id="stay-booking-contract">
      <header className="stay-doc__header">
        <div className="stay-doc__brand">
          <span className="stay-doc__logo logo__product" aria-label="BHD R">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bhd-official-symbol.svg" alt="" width="88" height="28" />
            <i>R</i>
          </span>
          <p className="stay-doc__tagline">
            {ar ? 'عقد / مستند حجز إقامة يومية' : 'Daily stay booking contract'}
          </p>
        </div>
        <div className="stay-doc__meta">
          <p className="stay-doc__kind">{ar ? 'مستند الحجز' : 'Booking record'}</p>
          <p className="stay-doc__number" dir="ltr">
            {booking.referenceCode}
          </p>
          <p className="stay-doc__issued">
            {ar ? 'تاريخ الطلب' : 'Requested'} · {issuedOn}
          </p>
        </div>
      </header>

      <p className="stay-doc__subtitle">
        {ar
          ? 'تفاصيل الطلب والحجز وبيانات التواصل والعقار وطريقة الدفع في مستند واحد.'
          : 'Request, guest contacts, property, and payment details in one contract-style record.'}
      </p>

      <div className="stay-doc__badge" data-paid={paid ? 'true' : 'false'}>
        {stayStatusLabel(booking.status, ar)}
      </div>

      <section className="stay-doc__section">
        <h2>{ar ? 'بيانات الحجز' : 'Booking details'}</h2>
        <dl className="stay-doc__grid">
          <Row label={ar ? 'المرجع' : 'Reference'} value={booking.referenceCode} ltr />
          <Row
            label={ar ? 'نمط الحجز' : 'Booking mode'}
            value={stayBookingModeLabel(booking.bookingMode, ar)}
          />
          <Row label={ar ? 'الوصول' : 'Check-in'} value={booking.checkInOn} ltr />
          <Row label={ar ? 'المغادرة' : 'Check-out'} value={booking.checkOutOn} ltr />
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
          {booking.stayType ? (
            <Row
              label={ar ? 'نوع الإقامة' : 'Stay type'}
              value={stayTypeLabel(booking.stayType, ar)}
            />
          ) : null}
          {typeof booking.adults === 'number' ? (
            <Row label={ar ? 'بالغون' : 'Adults'} value={String(booking.adults)} />
          ) : null}
          {typeof booking.children === 'number' ? (
            <Row label={ar ? 'أطفال' : 'Children'} value={String(booking.children)} />
          ) : null}
          <Row label={ar ? 'إجمالي الحجز' : 'Booking total'} value={amountLabel} ltr />
        </dl>
      </section>

      <section className="stay-doc__section">
        <h2>{ar ? 'الضيف ووسائل التواصل' : 'Guest & contacts'}</h2>
        <dl className="stay-doc__grid">
          <Row
            label={ar ? 'اسم الضيف' : 'Guest name'}
            value={booking.guestDisplayName || (ar ? 'غير متوفر' : 'Not provided')}
          />
          <Row
            label={ar ? 'البريد' : 'Email'}
            value={
              booking.guestEmail ? (
                <a href={`mailto:${booking.guestEmail}`}>{booking.guestEmail}</a>
              ) : (
                '—'
              )
            }
            ltr
          />
          <Row
            label={ar ? 'رقم التواصل' : 'Phone'}
            value={
              booking.guestPhone ? (
                <a href={`tel:${booking.guestPhone}`}>{booking.guestPhone}</a>
              ) : (
                '—'
              )
            }
            ltr
          />
        </dl>
      </section>

      <section className="stay-doc__section">
        <h2>{ar ? 'العقار والوحدة' : 'Property & unit'}</h2>
        <dl className="stay-doc__grid">
          <Row
            label={ar ? 'العقار' : 'Property'}
            value={
              <Link href={`/${portal}/properties/${booking.propertyId}`}>
                {propertyName || (ar ? 'فتح العقار' : 'Open property')}
              </Link>
            }
          />
          <Row
            label={ar ? 'الوحدة' : 'Unit'}
            value={
              <Link href={`/${portal}/properties/${booking.propertyId}?unit=${booking.unitId}`}>
                {unitLabel}
              </Link>
            }
          />
        </dl>
      </section>

      <section className="stay-doc__section">
        <h2>{ar ? 'الإيصال وطريقة الدفع' : 'Receipt & payment'}</h2>
        <dl className="stay-doc__grid">
          <Row
            label={ar ? 'حالة الدفع' : 'Payment status'}
            value={paymentStatusCopy(booking.paymentStatus, ar)}
          />
          <Row
            label={ar ? 'طريقة الدفع' : 'Payment method'}
            value={paymentMethodCopy(booking.paymentMethod, ar)}
          />
          {paidOn ? <Row label={ar ? 'تاريخ الدفع' : 'Paid at'} value={paidOn} /> : null}
          {booking.paymentProviderRef ? (
            <Row label={ar ? 'مرجع المزود' : 'Provider ref'} value={booking.paymentProviderRef} ltr />
          ) : null}
          <Row
            label={ar ? 'المبلغ المستلم' : 'Amount received'}
            value={paid ? paidAmountLabel : '—'}
            ltr
          />
          <Row
            label={ar ? 'إيصال الضيف' : 'Guest receipt'}
            value={
              <Link
                href={`/stays/booking/receipt?ref=${encodeURIComponent(booking.referenceCode)}&doc=payment`}
              >
                {ar ? 'فتح الإيصال' : 'Open receipt'}
              </Link>
            }
          />
          <Row
            label={ar ? 'تأكيد الحجز' : 'Confirmation'}
            value={
              <Link
                href={`/stays/booking/receipt?ref=${encodeURIComponent(booking.referenceCode)}&doc=confirmation`}
              >
                {ar ? 'فتح التأكيد' : 'Open confirmation'}
              </Link>
            }
          />
        </dl>
      </section>

      <div className="stay-doc__total">
        <span>{paid ? (ar ? 'المبلغ المستلم' : 'Amount received') : ar ? 'المبلغ المستحق' : 'Amount due'}</span>
        <strong dir="ltr">{paid ? paidAmountLabel : amountLabel}</strong>
      </div>

      <footer className="stay-doc__footer">
        <p>
          {ar
            ? 'هذا المستند ملخص تشغيلي للحجز من لوحة المالك. يُستخدم للمراجعة والمتابعة مع الضيف، وليس بديلاً عن عقد إيجار طويل الأجل.'
            : 'This is an operational booking record for the owner portal. It supports guest follow-up and is not a long-term lease contract.'}
        </p>
        <p className="stay-doc__thanks">{ar ? 'BHD R · منظومة BHD' : 'BHD R · BHD ecosystem'}</p>
      </footer>
    </article>
  );
}
