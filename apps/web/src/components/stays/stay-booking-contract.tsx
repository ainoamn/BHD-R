import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import { stayBookingModeLabel, stayStatusLabel, stayTypeLabel } from '@/lib/ui-labels';

export type StayBookingNeighbor = {
  id: string;
  referenceCode: string;
  checkInOn: string;
  checkOutOn: string;
  status: string;
  guestDisplayName?: string | null;
};

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
  /** Owner-authenticated media proxy URL. */
  propertyCoverUrl?: string | null;
  /** Public /stays/{slug} when published. */
  stayListingSlug?: string | null;
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
  /** Safe PCI display fields only — never full PAN. */
  cardLast4?: string | null;
  cardBrand?: string | null;
  cardholderName?: string | null;
  esignSignedAt?: string | null;
  esignSignaturePng?: string | null;
  esignIdFrontPng?: string | null;
  esignIdBackPng?: string | null;
  esignSelfiePng?: string | null;
  previousBooking?: StayBookingNeighbor | null;
  nextBooking?: StayBookingNeighbor | null;
  overlappingBookings?: StayBookingNeighbor[];
};

function Row({ label, value, ltr }: { label: string; value: ReactNode; ltr?: boolean }) {
  return (
    <div className="stay-doc__row">
      <dt>{label}</dt>
      <dd dir={ltr ? 'ltr' : undefined}>{value}</dd>
    </div>
  );
}

function cardBrandCopy(brand: string | null | undefined, ar: boolean): string {
  switch (brand) {
    case 'visa':
      return 'Visa';
    case 'mastercard':
      return 'Mastercard';
    case 'amex':
      return 'American Express';
    case 'other':
      return ar ? 'بطاقة' : 'Card';
    default:
      return ar ? 'بطاقة' : 'Card';
  }
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
    (ar ? booking.unitNameAr || booking.unitNameEn : booking.unitNameEn || booking.unitNameAr) ||
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

      {booking.propertyCoverUrl ? (
        <figure className="stay-doc__cover">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={booking.propertyCoverUrl}
            alt={propertyName || (ar ? 'صورة العقار' : 'Property photo')}
          />
          <figcaption>{propertyName || (ar ? 'العقار' : 'Property')}</figcaption>
        </figure>
      ) : null}

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
              <span className="stay-doc__link-stack">
                <Link href={`/${portal}/properties/${booking.propertyId}`}>
                  {propertyName || (ar ? 'فتح العقار' : 'Open property')}
                </Link>
                {booking.stayListingSlug ? (
                  <Link href={`/stays/${booking.stayListingSlug}`}>
                    {ar ? 'صفحة الإقامة العامة + التقويم' : 'Public stay page + calendar'}
                  </Link>
                ) : (
                  <Link href={`/properties/${booking.propertyId}`}>
                    {ar ? 'عرض العقار للعامة' : 'Public property page'}
                  </Link>
                )}
              </span>
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
          <Row
            label={ar ? 'تقويم الإقامات' : 'Stays calendar'}
            value={
              <Link href={`/${portal}/stays/calendar`}>
                {ar ? 'فتح التقويم الكامل' : 'Open full calendar'}
              </Link>
            }
          />
        </dl>
      </section>

      {(booking.overlappingBookings && booking.overlappingBookings.length > 0) ||
      booking.previousBooking ||
      booking.nextBooking ? (
        <section className="stay-doc__section">
          <h2>{ar ? 'حجوزات مجاورة على نفس الوحدة' : 'Neighboring bookings on this unit'}</h2>
          {booking.overlappingBookings && booking.overlappingBookings.length > 0 ? (
            <div className="notice notice--danger stay-doc__overlap" role="status">
              <p>
                {ar
                  ? 'تنبيه: توجد حجوزات حية متداخلة مع نفس التواريخ — راجع قبل القبول أو ارفض الطلب إن كان هناك خطأ.'
                  : 'Warning: live bookings overlap these dates — review before accepting, or reject if this is an error.'}
              </p>
              <ul className="stay-doc__neighbor-list">
                {booking.overlappingBookings.map((item) => (
                  <li key={item.id}>
                    <Link href={`/${portal}/stays/bookings/${item.id}`}>
                      <strong dir="ltr">{item.referenceCode}</strong>
                      <span dir="ltr">
                        {item.checkInOn} → {item.checkOutOn}
                      </span>
                      <span>{stayStatusLabel(item.status, ar)}</span>
                      {item.guestDisplayName ? <span>{item.guestDisplayName}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <dl className="stay-doc__grid">
            <Row
              label={ar ? 'الحجز السابق' : 'Previous booking'}
              value={
                booking.previousBooking ? (
                  <Link href={`/${portal}/stays/bookings/${booking.previousBooking.id}`}>
                    <span dir="ltr">{booking.previousBooking.referenceCode}</span>
                    {' · '}
                    <span dir="ltr">
                      {booking.previousBooking.checkInOn} → {booking.previousBooking.checkOutOn}
                    </span>
                    {' · '}
                    {stayStatusLabel(booking.previousBooking.status, ar)}
                  </Link>
                ) : ar ? (
                  'لا يوجد'
                ) : (
                  'None'
                )
              }
            />
            <Row
              label={ar ? 'الحجز اللاحق' : 'Next booking'}
              value={
                booking.nextBooking ? (
                  <Link href={`/${portal}/stays/bookings/${booking.nextBooking.id}`}>
                    <span dir="ltr">{booking.nextBooking.referenceCode}</span>
                    {' · '}
                    <span dir="ltr">
                      {booking.nextBooking.checkInOn} → {booking.nextBooking.checkOutOn}
                    </span>
                    {' · '}
                    {stayStatusLabel(booking.nextBooking.status, ar)}
                  </Link>
                ) : ar ? (
                  'لا يوجد'
                ) : (
                  'None'
                )
              }
            />
          </dl>
        </section>
      ) : null}

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
          {booking.cardholderName ? (
            <Row
              label={ar ? 'اسم حامل البطاقة' : 'Cardholder'}
              value={booking.cardholderName}
              ltr
            />
          ) : null}
          {booking.cardLast4 ? (
            <Row
              label={ar ? 'البطاقة' : 'Card'}
              value={`${cardBrandCopy(booking.cardBrand, ar)} •••• ${booking.cardLast4}`}
              ltr
            />
          ) : null}
          {paidOn ? <Row label={ar ? 'تاريخ الدفع' : 'Paid at'} value={paidOn} /> : null}
          {booking.paymentProviderRef ? (
            <Row
              label={ar ? 'مرجع المزود' : 'Provider ref'}
              value={booking.paymentProviderRef}
              ltr
            />
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

      {booking.esignSignaturePng ? (
        <section className="stay-doc__section">
          <h2>{ar ? 'التوقيع الإلكتروني والمستندات' : 'E-signature & documents'}</h2>
          {booking.esignSignedAt ? (
            <p className="muted">
              {ar ? 'وقت التوقيع' : 'Signed at'}:{' '}
              {new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(booking.esignSignedAt))}
            </p>
          ) : null}
          <div className="stay-doc__esign-grid">
            <figure>
              <figcaption>{ar ? 'التوقيع' : 'Signature'}</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={booking.esignSignaturePng} alt="" />
            </figure>
            {booking.esignIdFrontPng ? (
              <figure>
                <figcaption>{ar ? 'البطاقة أمام' : 'ID front'}</figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={booking.esignIdFrontPng} alt="" />
              </figure>
            ) : null}
            {booking.esignIdBackPng ? (
              <figure>
                <figcaption>{ar ? 'البطاقة خلف' : 'ID back'}</figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={booking.esignIdBackPng} alt="" />
              </figure>
            ) : null}
            {booking.esignSelfiePng ? (
              <figure>
                <figcaption>{ar ? 'سيلفي' : 'Selfie'}</figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={booking.esignSelfiePng} alt="" />
              </figure>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="stay-doc__total">
        <span>
          {paid
            ? ar
              ? 'المبلغ المستلم'
              : 'Amount received'
            : ar
              ? 'المبلغ المستحق'
              : 'Amount due'}
        </span>
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
