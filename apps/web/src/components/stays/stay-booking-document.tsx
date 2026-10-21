import { StayCheckinPass } from '@/components/stays/stay-checkin-pass';
import { formatMoney } from '@/lib/format';
import type { AccountingIssuer, AccountingSignature } from '@/lib/accounting-letterhead';
import {
  stayPaymentKindLabel,
  stayPaymentMethodLabel,
  type StayBookingPaymentKind,
} from '@/lib/stay-booking-payment-labels';
import { stayStatusLabel, stayTypeLabel } from '@/lib/ui-labels';

const BRAND_LOGO = '/brand/bhd-official-symbol.svg';

export type StayBookingDocumentPayment = {
  id: string;
  amountMinor: string;
  currency: string;
  kind: StayBookingPaymentKind;
  sequence: number;
  paidAt: string | null;
  provider: string;
  providerIntentId?: string | null;
};

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
  payment?: StayBookingDocumentPayment | null;
  paymentCount?: number;
};

export type StayBookingDocumentKind = 'payment' | 'confirmation';

function statusLabel(status: string, paid: boolean, ar: boolean): string {
  if (paid && (status === 'confirmed' || status === 'paid')) {
    return ar ? 'مؤكّد / مدفوع' : 'Confirmed / paid';
  }
  return stayStatusLabel(status, ar);
}

function stampOf(value: string, ar: boolean): string {
  return new Date(value).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Stay payment receipt / confirmation using the same official letterhead stack as
 * accounting print and rent receipts (company data, QR, print-ready layout).
 */
export function StayBookingDocument({
  kind,
  booking,
  locale,
  issuer,
  signature,
}: {
  kind: StayBookingDocumentKind;
  booking: StayBookingDocumentData;
  locale: string;
  issuer?: AccountingIssuer | null;
  signature?: AccountingSignature | null;
}) {
  const ar = locale === 'ar';
  const paid = booking.status === 'confirmed' || booking.status === 'paid';
  const payment = kind === 'payment' ? (booking.payment ?? null) : null;
  const titleAr =
    kind === 'payment'
      ? payment
        ? `إيصال قبض · ${stayPaymentKindLabel(payment.kind, true)}`
        : 'إيصال قبض'
      : 'تأكيد حجز';
  const titleEn =
    kind === 'payment'
      ? payment
        ? `Payment receipt · ${stayPaymentKindLabel(payment.kind, false)}`
        : 'Payment receipt'
      : 'Booking confirmation';
  const title = ar ? titleAr : titleEn;
  const titleAlt = ar ? titleEn : titleAr;
  const lead =
    kind === 'payment'
      ? payment
        ? ar
          ? `مستند رسمي لاستلام دفعة رقم ${payment.sequence}${(booking.paymentCount ?? 0) > 1 ? ` من ${booking.paymentCount}` : ''} المرتبطة بالحجز.`
          : `Official record of payment #${payment.sequence}${(booking.paymentCount ?? 0) > 1 ? ` of ${booking.paymentCount}` : ''} on this booking.`
        : ar
          ? 'مستند رسمي لاستلام مبلغ حجز إقامة يومية.'
          : 'Official record of stay booking payment.'
      : ar
        ? 'مستند رسمي لتأكيد تفاصيل حجز الإقامة.'
        : 'Official confirmation of stay booking details.';
  const amountMinor = payment?.amountMinor ?? booking.totalMinor;
  const amountCurrency = payment?.currency ?? booking.currency;
  const amountLabel =
    amountMinor && amountCurrency ? formatMoney(amountMinor, amountCurrency, locale) : null;
  const issuedOn = payment?.paidAt
    ? stampOf(payment.paidAt, ar)
    : new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
        dateStyle: 'medium',
      }).format(new Date());
  const issuerName = issuer
    ? ar
      ? issuer.nameAr
      : issuer.nameEn
    : ar
      ? 'BHD R'
      : 'BHD R';
  const docNumber = payment
    ? `${booking.referenceCode}-P${String(payment.sequence).padStart(2, '0')}`
    : booking.referenceCode;

  const meta: Array<{ labelAr: string; labelEn: string; value: string }> = [
    {
      labelAr: 'الحالة',
      labelEn: 'Status',
      value: statusLabel(booking.status, paid, ar),
    },
  ];
  if (booking.guestDisplayName) {
    meta.push({ labelAr: 'الضيف', labelEn: 'Guest', value: booking.guestDisplayName });
  }
  if (booking.guestEmail) {
    meta.push({ labelAr: 'البريد', labelEn: 'Email', value: booking.guestEmail });
  }
  if (booking.checkInOn) {
    meta.push({ labelAr: 'الوصول', labelEn: 'Check-in', value: booking.checkInOn });
  }
  if (booking.checkOutOn) {
    meta.push({ labelAr: 'المغادرة', labelEn: 'Check-out', value: booking.checkOutOn });
  }
  if (typeof booking.nights === 'number') {
    meta.push({
      labelAr: 'عدد الليالي',
      labelEn: 'Nights',
      value: String(booking.nights),
    });
  }
  if (booking.stayType) {
    meta.push({
      labelAr: 'نوع الحجز',
      labelEn: 'Stay type',
      value: stayTypeLabel(booking.stayType, ar),
    });
  }
  if (typeof booking.adults === 'number') {
    meta.push({ labelAr: 'بالغون', labelEn: 'Adults', value: String(booking.adults) });
  }
  if (typeof booking.children === 'number') {
    meta.push({ labelAr: 'أطفال', labelEn: 'Children', value: String(booking.children) });
  }
  if (payment) {
    meta.push({
      labelAr: 'نوع الدفعة',
      labelEn: 'Payment kind',
      value: stayPaymentKindLabel(payment.kind, ar),
    });
    meta.push({
      labelAr: 'طريقة الدفع',
      labelEn: 'Payment method',
      value: stayPaymentMethodLabel(payment.provider, ar),
    });
    if (payment.providerIntentId) {
      meta.push({
        labelAr: 'مرجع المزود',
        labelEn: 'Provider ref',
        value: payment.providerIntentId,
      });
    }
  }

  return (
    <article
      className="rent-doc rent-doc--receipt stay-receipt-doc"
      id="stay-receipt"
      data-doc-kind={kind}
      dir={ar ? 'rtl' : 'ltr'}
      lang={locale === 'en' ? 'en' : 'ar'}
      aria-label={docNumber}
    >
      <header className="rent-doc__head">
        <div className="rent-doc__issuer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={issuer?.logoDataUrl || BRAND_LOGO} alt="" width={132} height={52} />
          <div>
            <strong>{issuerName}</strong>
            {issuer && issuer.nameEn !== issuer.nameAr ? (
              <span lang={ar ? 'en' : 'ar'} dir={ar ? 'ltr' : 'rtl'}>
                {ar ? issuer.nameEn : issuer.nameAr}
              </span>
            ) : null}
            {issuer?.phone ? <small dir="ltr">{issuer.phone}</small> : null}
            {issuer?.email ? <small dir="ltr">{issuer.email}</small> : null}
            {issuer?.registrationNumber ? (
              <small dir="ltr">CR {issuer.registrationNumber}</small>
            ) : null}
          </div>
        </div>
        <div className="rent-doc__title">
          <h1>{title}</h1>
          <span className="rent-doc__title-alt" lang={ar ? 'en' : 'ar'}>
            {titleAlt}
          </span>
          <dl>
            <div>
              <dt>{ar ? 'الرقم' : 'No.'}</dt>
              <dd dir="ltr">{docNumber}</dd>
            </div>
            <div>
              <dt>{ar ? 'التاريخ' : 'Date'}</dt>
              <dd>{issuedOn}</dd>
            </div>
          </dl>
        </div>
      </header>

      <p className="rent-doc__lead">{lead}</p>

      <p
        className={`rent-doc__stamp rent-doc__stamp--${paid ? 'paid' : 'due'}`}
        style={{ margin: '0 0 0.75rem' }}
      >
        {statusLabel(booking.status, paid, ar)}
      </p>

      <dl className="rent-doc__parties">
        {meta.map((row) => (
          <div key={`${row.labelEn}-${row.value}`}>
            <dt>{ar ? row.labelAr : row.labelEn}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      {amountLabel ? (
        <div className="rent-doc__total">
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

      {kind === 'confirmation' ? (
        <div className="stay-doc__checkin-pass" style={{ marginTop: '1rem' }}>
          <StayCheckinPass locale={locale} referenceCode={booking.referenceCode} />
        </div>
      ) : null}

      {signature ? (
        <section
          className="rent-doc__sign"
          aria-label={ar ? 'التوقيع الإلكتروني' : 'Electronic signature'}
        >
          <div
            className="rent-doc__qr"
            role="img"
            aria-label={ar ? 'رمز التحقق من المستند' : 'Document verification code'}
            dangerouslySetInnerHTML={{ __html: signature.qrSvg }}
          />
          <div className="rent-doc__sign-body">
            <h2>
              <span aria-hidden="true">✓ </span>
              {ar ? 'موقّع إلكترونياً' : 'Electronically signed'}
            </h2>
            <dl>
              <div>
                <dt>{ar ? 'الموقّع' : 'Signed by'}</dt>
                <dd>
                  {ar
                    ? `${issuerName} — عبر منصة BHD R`
                    : `${issuerName} — via the BHD R platform`}
                </dd>
              </div>
              <div>
                <dt>{ar ? 'تاريخ التوقيع' : 'Signed at'}</dt>
                <dd>{stampOf(signature.signedAt, ar)}</dd>
              </div>
              <div>
                <dt>{ar ? 'رمز التوقيع' : 'Signature code'}</dt>
                <dd dir="ltr" className="rent-doc__code">
                  {signature.code}
                </dd>
              </div>
              <div>
                <dt>{ar ? 'بصمة المستند (SHA-256)' : 'Document fingerprint (SHA-256)'}</dt>
                <dd dir="ltr" className="rent-doc__hash">
                  {signature.fingerprint}
                </dd>
              </div>
            </dl>
            <p>
              {ar
                ? 'للتحقق من صحة المستند امسح الرمز أو افتح الرابط:'
                : 'To verify this document, scan the code or open:'}{' '}
              <bdi dir="ltr" className="rent-doc__url">
                {signature.verifyUrl}
              </bdi>
            </p>
          </div>
        </section>
      ) : null}

      <footer className="rent-doc__foot">
        {kind === 'payment'
          ? ar
            ? 'إيصال قبض إلكتروني صادر بترويسة الشركة عبر منصة BHD R. أي تعديل على بياناته يُبطل التحقق منه.'
            : 'An electronic payment receipt issued on the company letterhead via BHD R. Any change to its contents voids verification.'
          : ar
            ? 'تأكيد حجز إلكتروني صادر بترويسة الشركة. اعرض باركود الوصول أعلاه عند التسجيل.'
            : 'An electronic booking confirmation on the company letterhead. Show the check-in barcode above at arrival.'}
      </footer>
    </article>
  );
}
