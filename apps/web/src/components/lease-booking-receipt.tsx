import { formatMoney } from '@/lib/format';
import type { AccountingIssuer, AccountingSignature } from '@/lib/accounting-letterhead';

const BRAND_LOGO = '/brand/bhd-official-symbol.svg';

export type LeaseBookingReceiptData = {
  referenceCode: string;
  mode: 'rent' | 'sale';
  depositMinor: string;
  currency: string;
  depositPaidAt: string;
  cardLast4?: string | null;
  partyName: string;
  partyEmail?: string | null;
  propertyName: string;
  unitLabel: string;
};

function stampOf(value: string, ar: boolean): string {
  return new Date(value).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Official arabon receipt — same letterhead stack as stay payment receipts. */
export function LeaseBookingReceipt({
  booking,
  locale,
  issuer,
  signature,
}: {
  booking: LeaseBookingReceiptData;
  locale: 'ar' | 'en';
  issuer?: AccountingIssuer | null;
  signature?: AccountingSignature | null;
}) {
  const ar = locale === 'ar';
  const sale = booking.mode === 'sale';
  const titleAr = 'إيصال قبض · عربون حجز';
  const titleEn = 'Payment receipt · Booking deposit';
  const title = ar ? titleAr : titleEn;
  const titleAlt = ar ? titleEn : titleAr;
  const issuerName = issuer ? (ar ? issuer.nameAr : issuer.nameEn) : 'BHD R';
  const amount = formatMoney(booking.depositMinor, booking.currency, locale);
  const paidOn = stampOf(booking.depositPaidAt, ar);

  return (
    <article
      className="rent-doc rent-doc--receipt accounting-letterhead"
      dir={ar ? 'rtl' : 'ltr'}
      lang={locale}
      aria-label={booking.referenceCode}
    >
      <header className="rent-doc__head">
        <div className="rent-doc__issuer">
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
              <dd dir="ltr">{booking.referenceCode}</dd>
            </div>
            <div>
              <dt>{ar ? 'التاريخ' : 'Date'}</dt>
              <dd>{paidOn}</dd>
            </div>
          </dl>
        </div>
      </header>

      <p className="rent-doc__lead">
        {ar
          ? `مستند رسمي لاستلام عربون حجز ${sale ? 'شراء' : 'إيجار'} عبر منصة BHD R.`
          : `Official record of a ${sale ? 'purchase' : 'rent'} booking deposit received via BHD R.`}
      </p>

      <dl className="rent-doc__parties">
        <div>
          <dt>{sale ? (ar ? 'المشتري' : 'Buyer') : ar ? 'المستأجر' : 'Tenant'}</dt>
          <dd>{booking.partyName}</dd>
        </div>
        {booking.partyEmail ? (
          <div>
            <dt>{ar ? 'البريد' : 'Email'}</dt>
            <dd dir="ltr">{booking.partyEmail}</dd>
          </div>
        ) : null}
        <div>
          <dt>{ar ? 'العقار' : 'Property'}</dt>
          <dd>{booking.propertyName}</dd>
        </div>
        <div>
          <dt>{ar ? 'الوحدة' : 'Unit'}</dt>
          <dd>{booking.unitLabel}</dd>
        </div>
        <div>
          <dt>{ar ? 'نوع الحجز' : 'Booking type'}</dt>
          <dd>{sale ? (ar ? 'شراء' : 'Purchase') : ar ? 'إيجار' : 'Rent'}</dd>
        </div>
        <div>
          <dt>{ar ? 'المبلغ' : 'Amount'}</dt>
          <dd dir="ltr">{amount}</dd>
        </div>
        {booking.cardLast4 ? (
          <div>
            <dt>{ar ? 'بطاقة الدفع' : 'Card'}</dt>
            <dd dir="ltr">•••• {booking.cardLast4}</dd>
          </div>
        ) : null}
        <div>
          <dt>{ar ? 'الحالة' : 'Status'}</dt>
          <dd>{ar ? 'مدفوع / معتمد' : 'Paid / approved'}</dd>
        </div>
      </dl>

      {signature ? (
        <footer className="rent-doc__sign">
          <div>
            <strong>{ar ? 'اعتماد إلكتروني' : 'Electronic approval'}</strong>
            <span dir="ltr">{signature.code}</span>
            <small>{stampOf(signature.signedAt, ar)}</small>
          </div>
          {signature.qrSvg ? (
            <div
              className="rent-doc__qr"
              dangerouslySetInnerHTML={{ __html: signature.qrSvg }}
              aria-hidden="true"
            />
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}
