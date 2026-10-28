import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { BadgeChips } from '@/components/badges/badge-chips';
import { Icon, type IconName } from '@/components/pmh-icon';
import { PropertyLocationMap } from '@/components/property-location-map';
import type { BadgeChip } from '@/lib/badges-shared';
import { StayBookingTimelineSection } from '@/components/stays/stay-booking-timeline';
import type { PropertyLocation } from '@/lib/contract-document';
import { formatMoney } from '@/lib/format';
import type { StayBookingTimelineFacts } from '@/lib/stay-booking-timeline';
import { stayPaymentKindLabel, stayPaymentMethodLabel } from '@/lib/stay-booking-payment-labels';
import type { StayBookingPaymentLine } from '@/lib/stay-booking-payments';
import { stayBookingModeLabel, stayStatusLabel, stayTypeLabel } from '@/lib/ui-labels';

export type StayBookingNeighbor = {
  id: string;
  referenceCode: string;
  checkInOn: string;
  checkOutOn: string;
  status: string;
  guestDisplayName?: string | null;
};

export type StayBookingPendingReschedule = {
  status: 'awaiting_owner' | 'awaiting_guest_payment' | 'awaiting_payment';
  checkInOn: string;
  checkOutOn: string;
  stayType: string;
  extraDueMinor: string;
  quotedTotalMinor: string;
  chargedTotalMinor: string;
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
  guestPartyId?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  adults?: number | null;
  children?: number | null;
  stayType?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  /** Half-day bookings: status and price of the other slot on the same date. */
  otherSlot?: {
    slot: 'morning' | 'evening';
    status: 'available' | 'booked' | 'hold' | 'blocked';
    rateMinor: string | null;
  } | null;
  propertyId: string;
  propertyNameAr?: string | null;
  propertyNameEn?: string | null;
  /** Owner-authenticated media proxy URL. */
  propertyCoverUrl?: string | null;
  /** Map pin and the QR code that opens the property's location. */
  location?: PropertyLocation | null;
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
  /** Succeeded payment intents — one receipt each (booking + top-ups). */
  payments?: StayBookingPaymentLine[];
  /** Safe PCI display fields only — never full PAN. */
  cardLast4?: string | null;
  cardBrand?: string | null;
  cardholderName?: string | null;
  esignSignedAt?: string | null;
  esignSignaturePng?: string | null;
  esignIdFrontPng?: string | null;
  esignIdBackPng?: string | null;
  esignSelfiePng?: string | null;
  pendingReschedule?: StayBookingPendingReschedule | null;
  previousBooking?: StayBookingNeighbor | null;
  nextBooking?: StayBookingNeighbor | null;
  overlappingBookings?: StayBookingNeighbor[];
  timeline?: StayBookingTimelineFacts | null;
  /** Parent stay contract (initial), when issued. */
  contract?: { id: string; reference: string; status: string } | null;
  /** Latest date-change amendment linked to the parent contract. */
  amendmentContract?: { id: string; reference: string; status: string } | null;
};

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
    case 'offline':
      return ar
        ? 'خارج المنصة (لم يُسجَّل دفع إلكتروني)'
        : 'Outside the platform (no online payment)';
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
    case 'offline':
      return ar ? 'اعتُمد الحجز دون دفع عبر المنصة' : 'Approved without an online payment';
    default:
      return status;
  }
}

function stayScopeCopy(stayType: string | null | undefined, ar: boolean): string {
  if (stayType === 'day_use') {
    return ar ? 'حجز جزئي — الفترة الصباحية (بدون مبيت)' : 'Partial — morning slot (day use)';
  }
  if (stayType === 'overnight_only') {
    return ar ? 'حجز جزئي — الفترة المسائية (مبيت فقط)' : 'Partial — evening slot (overnight only)';
  }
  return ar ? 'حجز كلي — اليوم كاملاً (مع مبيت)' : 'Full — whole day (overnight stay)';
}

function otherSlotCopy(
  other: NonNullable<StayBookingContractData['otherSlot']>,
  currency: string,
  locale: string,
): string {
  const ar = locale === 'ar';
  switch (other.status) {
    case 'available': {
      const price = other.rateMinor ? formatMoney(other.rateMinor, currency, locale) : null;
      const label = ar ? 'شاغرة' : 'Available';
      return price ? `${label} — ${ar ? 'متاحة للحجز بقيمة' : 'bookable for'} ${price}` : label;
    }
    case 'booked':
      return ar ? 'محجوزة (اليوم محجوز كليًا)' : 'Booked (day fully booked)';
    case 'hold':
      return ar ? 'محجوزة مؤقتًا' : 'On hold';
    default:
      return ar ? 'مغلقة' : 'Closed';
  }
}

function dateRange(from: string, to: string): string {
  return `${from} → ${to}`;
}

function FactTable({
  title,
  icon,
  tone,
  rows,
}: {
  title: string;
  icon: IconName;
  tone?: 'default' | 'warn' | 'danger' | 'ok';
  rows: Array<{ label: string; value: ReactNode; ltr?: boolean; highlight?: boolean }>;
}) {
  return (
    <section className={`stay-desk__panel stay-desk__panel--${tone ?? 'default'}`}>
      <header className="stay-desk__panel-head">
        <Icon name={icon} size={18} />
        <h2>{title}</h2>
      </header>
      <div className="stay-desk__table-wrap">
        <table className="stay-desk__table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={row.highlight ? 'is-highlight' : undefined}>
                <th scope="row">{row.label}</th>
                <td dir={row.ltr ? 'ltr' : undefined}>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DocSection({
  id,
  title,
  icon,
  children,
  collapsible = false,
}: {
  id?: string;
  title: string;
  icon: IconName;
  children: ReactNode;
  /** Screen-only collapse; always expanded when printing. */
  collapsible?: boolean;
}) {
  if (!collapsible) {
    return (
      <section className="stay-desk__section" id={id}>
        <header className="stay-desk__section-head">
          <Icon name={icon} size={16} />
          <h2>{title}</h2>
        </header>
        <div className="stay-desk__section-body">{children}</div>
      </section>
    );
  }
  return (
    <details className="stay-desk__fold stay-desk__section" id={id} open>
      <summary className="stay-desk__section-head">
        <Icon name={icon} size={16} />
        <h2>{title}</h2>
      </summary>
      <div className="stay-desk__section-body stay-desk__fold-body">{children}</div>
    </details>
  );
}

export function StayBookingContract({
  booking,
  locale,
  portal,
  badges,
}: {
  booking: StayBookingContractData;
  locale: string;
  portal: 'owner' | 'developer';
  badges?: { property: BadgeChip[]; guest: BadgeChip[] };
}) {
  const ar = locale === 'ar';
  const paid = booking.paymentStatus === 'succeeded';
  const offline = booking.paymentStatus === 'offline';
  const propertyName = ar
    ? booking.propertyNameAr || booking.propertyNameEn
    : booking.propertyNameEn || booking.propertyNameAr;
  const unitLabel =
    (ar ? booking.unitNameAr || booking.unitNameEn : booking.unitNameEn || booking.unitNameAr) ||
    booking.unitCode ||
    '—';
  const amountLabel = formatMoney(booking.totalMinor, booking.currency, locale);
  const paidSumMinor =
    (booking.payments?.length ?? 0) > 0
      ? booking.payments!.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n).toString()
      : booking.paidAmountMinor;
  const paidAmountLabel =
    paidSumMinor && (booking.paidCurrency || booking.currency)
      ? formatMoney(paidSumMinor, booking.paidCurrency || booking.currency, locale)
      : amountLabel;
  const paymentBreakdown =
    (booking.payments?.length ?? 0) > 1
      ? booking
          .payments!.map(
            (line) =>
              `${stayPaymentKindLabel(line.kind, ar)} ${formatMoney(line.amountMinor, line.currency, locale)}`,
          )
          .join(ar ? ' + ' : ' + ')
      : null;
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
  const pending = booking.pendingReschedule ?? null;
  const nightsLabel = `${booking.nights} ${
    ar ? (booking.nights === 1 ? 'ليلة' : 'ليالٍ') : booking.nights === 1 ? 'night' : 'nights'
  }`;
  const guestsLabel = [
    typeof booking.adults === 'number'
      ? `${booking.adults} ${ar ? (booking.adults === 1 ? 'بالغ' : 'بالغون') : booking.adults === 1 ? 'adult' : 'adults'}`
      : null,
    typeof booking.children === 'number' && booking.children > 0
      ? `${booking.children} ${ar ? (booking.children === 1 ? 'طفل' : 'أطفال') : booking.children === 1 ? 'child' : 'children'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const checkInLabel = booking.checkInTime
    ? `${booking.checkInOn} · ${booking.checkInTime}`
    : booking.checkInOn;
  const checkOutLabel = booking.checkOutTime
    ? `${booking.stayType === 'day_use' ? booking.checkInOn : booking.checkOutOn} · ${booking.checkOutTime}`
    : booking.checkOutOn;

  return (
    <article className="stay-doc stay-doc--contract stay-desk" id="stay-booking-contract">
      <header className="stay-desk__letterhead">
        <div className="stay-desk__brand">
          <span className="stay-desk__logo logo__product" aria-label="BHD R">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bhd-official-symbol.svg" alt="" width="96" height="32" />
            <i>R</i>
          </span>
          <div className="stay-desk__brand-copy">
            <p className="stay-desk__org">BHD R</p>
            <p className="stay-desk__doc-type">
              {ar ? 'مستند حجز إقامة يومية رسمي' : 'Official daily stay booking record'}
            </p>
          </div>
        </div>
        <div className="stay-desk__letterhead-meta">
          <p className="stay-desk__ref" dir="ltr">
            {booking.referenceCode}
          </p>
          <p className="stay-desk__sub">
            {ar ? 'تاريخ الطلب' : 'Requested'} · {issuedOn}
          </p>
          <span
            className="stay-desk__status"
            data-tone={
              pending
                ? 'danger'
                : paid || offline
                  ? 'ok'
                  : booking.paymentStatus === 'pending'
                    ? 'warn'
                    : 'default'
            }
          >
            <Icon name={pending ? 'alert' : paid || offline ? 'check' : 'clock'} size={16} />
            {pending
              ? ar
                ? 'طلب تعديل التواريخ'
                : 'Date change requested'
              : stayStatusLabel(booking.status, ar)}
          </span>
        </div>
      </header>

      <div className="stay-desk__hero">
        <div className="stay-desk__hero-main">
          <p className="stay-desk__kicker">{ar ? 'ملخص الحجز' : 'Booking summary'}</p>
          <h1 className="stay-desk__title">
            {propertyName || (ar ? 'إقامة يومية' : 'Daily stay')}
            <span className="stay-desk__title-unit"> · {unitLabel}</span>
          </h1>
          <p className="stay-desk__sub" dir="ltr">
            {dateRange(booking.checkInOn, booking.checkOutOn)}
            {guestsLabel ? ` · ${guestsLabel}` : ''}
          </p>
        </div>
        <div className="stay-desk__hero-side">
          <p className="stay-desk__amount" dir="ltr">
            {paid ? paidAmountLabel : amountLabel}
          </p>
          <p className="stay-desk__amount-label">
            {paid
              ? ar
                ? 'إجمالي المستلم'
                : 'Total received'
              : offline
                ? ar
                  ? 'قيمة الحجز'
                  : 'Booking value'
                : ar
                  ? 'المبلغ المستحق'
                  : 'Amount due'}
          </p>
          {paid ? (
            <p className="stay-desk__amount-meta muted">
              {ar ? `قيمة الحجز الحالية ${amountLabel}` : `Current booking value ${amountLabel}`}
              {paymentBreakdown ? (
                <>
                  <br />
                  <span dir="ltr">{paymentBreakdown}</span>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>

      {pending ? (
        <section className="stay-desk__change" aria-label={ar ? 'تعديل التواريخ' : 'Date change'}>
          <header className="stay-desk__change-head">
            <Icon name="calendar" size={18} />
            <div>
              <h2>{ar ? 'طلب تعديل التواريخ' : 'Requested date change'}</h2>
              <p>
                {pending.status === 'awaiting_owner'
                  ? ar
                    ? 'بانتظار اعتمادك — راجع الفترة الحالية والمطلوبة أدناه.'
                    : 'Awaiting your approval — compare current and requested dates below.'
                  : pending.status === 'awaiting_guest_payment'
                    ? ar
                      ? 'اعتُمد التعديل — بانتظار دفع الضيف للفرق.'
                      : 'Change approved — waiting for the guest to pay the difference.'
                    : ar
                      ? 'بانتظار إتمام الدفع لإكمال التعديل.'
                      : 'Awaiting payment to finish the change.'}
              </p>
            </div>
          </header>
          <div className="stay-desk__table-wrap">
            <table className="stay-desk__table stay-desk__table--change">
              <thead>
                <tr>
                  <th scope="col">{ar ? 'البيان' : 'Item'}</th>
                  <th scope="col">{ar ? 'من (الحالي)' : 'From (current)'}</th>
                  <th scope="col">{ar ? 'إلى (المطلوب)' : 'To (requested)'}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">{ar ? 'الفترة' : 'Dates'}</th>
                  <td className="is-from" dir="ltr">
                    {dateRange(booking.checkInOn, booking.checkOutOn)}
                  </td>
                  <td className="is-to" dir="ltr">
                    {dateRange(pending.checkInOn, pending.checkOutOn)}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{ar ? 'نوع الإقامة' : 'Stay type'}</th>
                  <td className="is-from">
                    {booking.stayType ? stayTypeLabel(booking.stayType, ar) : '—'}
                  </td>
                  <td className="is-to">{stayTypeLabel(pending.stayType, ar)}</td>
                </tr>
                <tr>
                  <th scope="row">{ar ? 'إجمالي العرض' : 'Quoted total'}</th>
                  <td className="is-from" dir="ltr">
                    {amountLabel}
                  </td>
                  <td className="is-to" dir="ltr">
                    {formatMoney(
                      pending.quotedTotalMinor || pending.chargedTotalMinor,
                      booking.currency,
                      locale,
                    )}
                  </td>
                </tr>
                {pending.extraDueMinor !== '0' ? (
                  <tr>
                    <th scope="row">{ar ? 'فرق الدفع' : 'Top-up due'}</th>
                    <td>—</td>
                    <td className="is-to" dir="ltr">
                      {formatMoney(pending.extraDueMinor, booking.currency, locale)}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="stay-desk__kpis" role="list">
        <div className="stay-desk__kpi" role="listitem">
          <Icon name="arrivals" size={18} />
          <span>{ar ? 'الوصول' : 'Check-in'}</span>
          <strong dir="ltr">{checkInLabel}</strong>
        </div>
        <div className="stay-desk__kpi" role="listitem">
          <Icon name="departures" size={18} />
          <span>{ar ? 'المغادرة' : 'Check-out'}</span>
          <strong dir="ltr">{checkOutLabel}</strong>
        </div>
        <div className="stay-desk__kpi" role="listitem">
          <Icon name="bed" size={18} />
          <span>{ar ? 'الليالي' : 'Nights'}</span>
          <strong>{nightsLabel}</strong>
        </div>
        <div className="stay-desk__kpi" role="listitem">
          <Icon name="users" size={18} />
          <span>{ar ? 'الضيوف' : 'Guests'}</span>
          <strong>{guestsLabel || '—'}</strong>
        </div>
        <div
          className="stay-desk__kpi"
          role="listitem"
          data-tone={paid ? 'ok' : offline ? 'ok' : 'warn'}
        >
          <Icon name="receipt" size={18} />
          <span>{ar ? 'الدفع' : 'Payment'}</span>
          <strong>{paymentStatusCopy(booking.paymentStatus, ar)}</strong>
        </div>
      </div>

      {booking.timeline ? (
        <StayBookingTimelineSection
          facts={booking.timeline}
          bookingId={booking.id}
          propertyId={booking.propertyId}
          status={booking.status}
          bookingMode={booking.bookingMode}
          createdAt={booking.createdAt}
          currency={booking.currency}
          locale={locale}
          portal={portal}
        />
      ) : null}

      <div className="stay-desk__grid">
        <FactTable
          title={ar ? 'بيانات الحجز' : 'Booking'}
          icon="calendar"
          rows={[
            { label: ar ? 'المرجع' : 'Reference', value: booking.referenceCode, ltr: true },
            {
              label: ar ? 'الحالة' : 'Status',
              value: stayStatusLabel(booking.status, ar),
              highlight: Boolean(pending),
            },
            {
              label: ar ? 'نمط الحجز' : 'Booking mode',
              value: stayBookingModeLabel(booking.bookingMode, ar),
            },
            { label: ar ? 'الوصول' : 'Check-in', value: checkInLabel, ltr: true },
            { label: ar ? 'المغادرة' : 'Check-out', value: checkOutLabel, ltr: true },
            { label: ar ? 'عدد الليالي' : 'Nights', value: nightsLabel },
            ...(booking.stayType
              ? [
                  {
                    label: ar ? 'نوع الإقامة' : 'Stay type',
                    value: stayTypeLabel(booking.stayType, ar),
                  },
                ]
              : []),
            {
              label: ar ? 'نطاق الحجز' : 'Booking scope',
              value: stayScopeCopy(booking.stayType, ar),
            },
            ...(booking.otherSlot
              ? [
                  {
                    label:
                      booking.otherSlot.slot === 'morning'
                        ? ar
                          ? 'الفترة الصباحية'
                          : 'Morning slot'
                        : ar
                          ? 'الفترة المسائية'
                          : 'Evening slot',
                    value: otherSlotCopy(booking.otherSlot, booking.currency, locale),
                  },
                ]
              : []),
            { label: ar ? 'إجمالي الحجز' : 'Booking total', value: amountLabel, ltr: true },
          ]}
        />

        <FactTable
          title={ar ? 'الضيف' : 'Guest'}
          icon="users"
          rows={[
            {
              label: ar ? 'الاسم' : 'Name',
              value: (
                <span className="name-with-mark">
                  {booking.guestDisplayName || (ar ? 'غير متوفر' : 'Not provided')}
                  <BadgeChips badges={badges?.guest} locale={locale} />
                </span>
              ),
            },
            {
              label: ar ? 'البريد' : 'Email',
              value: booking.guestEmail ? (
                <a href={`mailto:${booking.guestEmail}`}>{booking.guestEmail}</a>
              ) : (
                '—'
              ),
              ltr: true,
            },
            {
              label: ar ? 'الهاتف' : 'Phone',
              value: booking.guestPhone ? (
                <a href={`tel:${booking.guestPhone}`}>{booking.guestPhone}</a>
              ) : (
                '—'
              ),
              ltr: true,
            },
            ...(guestsLabel
              ? [{ label: ar ? 'عدد الضيوف' : 'Party size', value: guestsLabel }]
              : []),
          ]}
        />

        <FactTable
          title={ar ? 'العقار والوحدة' : 'Property & unit'}
          icon="home"
          rows={[
            {
              label: ar ? 'العقار' : 'Property',
              value: (
                <span className="stay-doc__link-stack">
                  <span className="name-with-mark">
                    <Link href={`/${portal}/properties/${booking.propertyId}`}>
                      {propertyName || (ar ? 'فتح العقار' : 'Open property')}
                    </Link>
                    <BadgeChips badges={badges?.property} locale={locale} />
                  </span>
                  {booking.stayListingSlug ? (
                    <Link href={`/stays/${booking.stayListingSlug}`}>
                      {ar ? 'صفحة الإقامة العامة' : 'Public stay page'}
                    </Link>
                  ) : (
                    <Link href={`/properties/${booking.propertyId}`}>
                      {ar ? 'عرض العقار للعامة' : 'Public property page'}
                    </Link>
                  )}
                </span>
              ),
            },
            {
              label: ar ? 'الوحدة' : 'Unit',
              value: (
                <Link href={`/${portal}/properties/${booking.propertyId}?unit=${booking.unitId}`}>
                  {unitLabel}
                </Link>
              ),
            },
            {
              label: ar ? 'التقويم' : 'Calendar',
              value: (
                <Link href={`/${portal}/stays/calendar`}>
                  {ar ? 'فتح التقويم الكامل' : 'Open full calendar'}
                </Link>
              ),
            },
          ]}
        />

        <FactTable
          title={ar ? 'الدفع والمستندات' : 'Payment & documents'}
          icon="receipt"
          tone={paid ? 'ok' : offline ? 'default' : 'warn'}
          rows={[
            {
              label: ar ? 'حالة الدفع' : 'Payment status',
              value: paymentStatusCopy(booking.paymentStatus, ar),
              highlight: !paid && !offline,
            },
            {
              label: ar ? 'عدد الدفعات' : 'Payments',
              value:
                (booking.payments?.length ?? 0) > 0
                  ? ar
                    ? `${booking.payments!.length} ${booking.payments!.length === 1 ? 'دفعة' : 'دفعات'}`
                    : `${booking.payments!.length} ${booking.payments!.length === 1 ? 'payment' : 'payments'}`
                  : paid
                    ? ar
                      ? 'دفعة واحدة'
                      : '1 payment'
                    : '—',
            },
            {
              label: ar ? 'طريقة الدفع' : 'Payment method',
              value: paymentMethodCopy(booking.paymentMethod, ar),
            },
            ...(booking.cardholderName
              ? [
                  {
                    label: ar ? 'اسم حامل البطاقة' : 'Cardholder',
                    value: booking.cardholderName,
                    ltr: true as const,
                  },
                ]
              : []),
            ...(booking.cardLast4
              ? [
                  {
                    label: ar ? 'البطاقة' : 'Card',
                    value: `${cardBrandCopy(booking.cardBrand, ar)} •••• ${booking.cardLast4}`,
                    ltr: true as const,
                  },
                ]
              : []),
            ...(paidOn ? [{ label: ar ? 'آخر دفعة' : 'Last paid', value: paidOn }] : []),
            {
              label: ar ? 'قيمة الحجز الحالية' : 'Current booking value',
              value: amountLabel,
              ltr: true,
            },
            {
              label: ar ? 'إجمالي المستلم' : 'Total received',
              value: paid ? paidAmountLabel : '—',
              ltr: true,
            },
            ...(paymentBreakdown
              ? [
                  {
                    label: ar ? 'تفصيل الدفعات' : 'Payment breakdown',
                    value: paymentBreakdown,
                    ltr: true as const,
                  },
                ]
              : []),
            {
              label: ar ? 'عقد الإقامة' : 'Stay contract',
              value: booking.contract ? (
                <Link href={`/${portal}/contracts/${booking.contract.id}`}>
                  <bdi dir="ltr">{booking.contract.reference}</bdi>
                </Link>
              ) : booking.esignSignaturePng ? (
                <a href="#stay-esign">
                  {ar ? 'عرض التوقيع والمستندات' : 'View signature & documents'}
                </a>
              ) : ar ? (
                'لم يُصدَر بعد'
              ) : (
                'Not issued yet'
              ),
            },
            ...(booking.amendmentContract
              ? [
                  {
                    label: ar ? 'آخر ملحق تعديل' : 'Latest amendment',
                    value: (
                      <Link href={`/${portal}/contracts/${booking.amendmentContract.id}`}>
                        <bdi dir="ltr">{booking.amendmentContract.reference}</bdi>
                      </Link>
                    ),
                  },
                ]
              : []),
            {
              label: ar ? 'تأكيد الحجز' : 'Confirmation',
              value: (
                <Link
                  href={`/stays/booking/receipt?ref=${encodeURIComponent(booking.referenceCode)}&doc=confirmation`}
                >
                  {ar ? 'فتح التأكيد والباركود' : 'Open confirmation & barcode'}
                </Link>
              ),
            },
          ]}
        />
      </div>

      {(booking.payments?.length ?? 0) > 0 ? (
        <DocSection
          title={ar ? 'سجل الدفعات والإيصالات' : 'Payment ledger & receipts'}
          icon="receipt"
        >
          <p className="muted">
            {ar
              ? 'كل معاملة ناجحة لها إيصال مستقل — دفعة الحجز وفرق تعديل التواريخ منفصلان.'
              : 'Each successful charge has its own receipt — booking payment and date-change top-ups are separate.'}
          </p>
          <div className="stay-desk__table-wrap">
            <table className="stay-desk__table">
              <thead>
                <tr>
                  <th>{ar ? '#' : '#'}</th>
                  <th>{ar ? 'النوع' : 'Kind'}</th>
                  <th>{ar ? 'المبلغ' : 'Amount'}</th>
                  <th>{ar ? 'الطريقة' : 'Method'}</th>
                  <th>{ar ? 'التاريخ' : 'Paid at'}</th>
                  <th>{ar ? 'المرجع' : 'Ref'}</th>
                  <th>{ar ? 'الإيصال' : 'Receipt'}</th>
                </tr>
              </thead>
              <tbody>
                {booking.payments!.map((line) => {
                  const when = line.paidAt
                    ? new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(line.paidAt))
                    : '—';
                  return (
                    <tr key={line.id}>
                      <td dir="ltr">{line.sequence}</td>
                      <td>{stayPaymentKindLabel(line.kind, ar)}</td>
                      <td dir="ltr">{formatMoney(line.amountMinor, line.currency, locale)}</td>
                      <td>{stayPaymentMethodLabel(line.provider, ar)}</td>
                      <td>{when}</td>
                      <td dir="ltr">{line.providerIntentId || '—'}</td>
                      <td>
                        <Link
                          href={`/stays/booking/receipt?ref=${encodeURIComponent(booking.referenceCode)}&doc=payment&pay=${encodeURIComponent(line.id)}`}
                        >
                          {ar ? 'تنزيل' : 'Download'}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DocSection>
      ) : null}

      {(booking.overlappingBookings && booking.overlappingBookings.length > 0) ||
      booking.previousBooking ||
      booking.nextBooking ? (
        <DocSection
          title={ar ? 'حجوزات مجاورة على نفس الوحدة' : 'Neighboring bookings on this unit'}
          icon="list"
          collapsible
        >
          {booking.overlappingBookings && booking.overlappingBookings.length > 0 ? (
            <div className="notice notice--danger stay-doc__overlap" role="status">
              <p>
                {ar
                  ? 'تنبيه: توجد حجوزات حية متداخلة مع نفس التواريخ — راجع قبل القبول أو ارفض الطلب إن كان هناك خطأ.'
                  : 'Warning: live bookings overlap these dates — review before accepting, or reject if this is an error.'}
              </p>
              <div className="stay-desk__table-wrap">
                <table className="stay-desk__table">
                  <thead>
                    <tr>
                      <th>{ar ? 'المرجع' : 'Ref'}</th>
                      <th>{ar ? 'الفترة' : 'Dates'}</th>
                      <th>{ar ? 'الحالة' : 'Status'}</th>
                      <th>{ar ? 'الضيف' : 'Guest'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {booking.overlappingBookings.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <Link href={`/${portal}/stays/bookings/${item.id}`} dir="ltr">
                            {item.referenceCode}
                          </Link>
                        </td>
                        <td dir="ltr">{dateRange(item.checkInOn, item.checkOutOn)}</td>
                        <td>{stayStatusLabel(item.status, ar)}</td>
                        <td>{item.guestDisplayName || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <div className="stay-desk__table-wrap">
            <table className="stay-desk__table">
              <tbody>
                <tr>
                  <th scope="row">{ar ? 'الحجز السابق' : 'Previous booking'}</th>
                  <td>
                    {booking.previousBooking ? (
                      <Link href={`/${portal}/stays/bookings/${booking.previousBooking.id}`}>
                        <span dir="ltr">{booking.previousBooking.referenceCode}</span>
                        {' · '}
                        <span dir="ltr">
                          {dateRange(
                            booking.previousBooking.checkInOn,
                            booking.previousBooking.checkOutOn,
                          )}
                        </span>
                        {' · '}
                        {stayStatusLabel(booking.previousBooking.status, ar)}
                      </Link>
                    ) : ar ? (
                      'لا يوجد'
                    ) : (
                      'None'
                    )}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{ar ? 'الحجز اللاحق' : 'Next booking'}</th>
                  <td>
                    {booking.nextBooking ? (
                      <Link href={`/${portal}/stays/bookings/${booking.nextBooking.id}`}>
                        <span dir="ltr">{booking.nextBooking.referenceCode}</span>
                        {' · '}
                        <span dir="ltr">
                          {dateRange(booking.nextBooking.checkInOn, booking.nextBooking.checkOutOn)}
                        </span>
                        {' · '}
                        {stayStatusLabel(booking.nextBooking.status, ar)}
                      </Link>
                    ) : ar ? (
                      'لا يوجد'
                    ) : (
                      'None'
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </DocSection>
      ) : null}

      {booking.location || booking.propertyCoverUrl ? (
        <DocSection title={ar ? 'الموقع والصورة' : 'Location & photo'} icon="pin" collapsible>
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
          {booking.location ? (
            <PropertyLocationMap location={booking.location} locale={locale} />
          ) : null}
        </DocSection>
      ) : null}

      {booking.esignSignaturePng ? (
        <DocSection
          id="stay-esign"
          title={ar ? 'التوقيع الإلكتروني والمستندات' : 'E-signature & documents'}
          icon="file"
          collapsible
        >
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
        </DocSection>
      ) : null}

      <footer className="stay-doc__footer stay-desk__seal">
        <div className="stay-desk__seal-brand">
          <span className="stay-desk__logo logo__product" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bhd-official-symbol.svg" alt="" width="72" height="24" />
            <i>R</i>
          </span>
          <p className="stay-doc__thanks">{ar ? 'BHD R · منظومة BHD' : 'BHD R · BHD ecosystem'}</p>
        </div>
        <p>
          {ar
            ? 'مستند رسمي تشغيلي من لوحة المالك — للمراجعة والمتابعة مع الضيف. ليس بديلاً عن عقد إيجار طويل الأجل.'
            : 'Official operational record from the owner portal — for review and guest follow-up. Not a long-term lease contract.'}
        </p>
      </footer>
    </article>
  );
}
