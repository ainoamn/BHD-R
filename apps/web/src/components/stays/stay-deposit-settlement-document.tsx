import { formatMoney } from '@/lib/format';
import type { GuestDepositSettlementDoc } from '@/lib/stay-deposit-settlement-docs-neon';

const BRAND_LOGO = '/brand/bhd-official-symbol.svg';

const METHOD: Record<string, { ar: string; en: string }> = {
  bank: { ar: 'تحويل بنكي', en: 'Bank transfer' },
  phone: { ar: 'تحويل عبر رقم الهاتف', en: 'Transfer by phone number' },
};

function stamp(value: string | null | undefined, ar: boolean): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00+04:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
    dateStyle: 'long',
    ...(value.length > 10 ? { timeStyle: 'short' as const } : {}),
    timeZone: 'Asia/Muscat',
  }).format(date);
}

function stampOf(value: string, ar: boolean): string {
  return new Date(value).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Accounting reverse / refund document: company letterhead, settlement facts,
 * electronic signature and verification barcode (same stack as rent receipts).
 */
export function StayDepositSettlementDocument({
  doc,
  locale,
}: {
  doc: GuestDepositSettlementDoc;
  locale: string;
}) {
  const ar = locale === 'ar';
  const money = (minor: string) => formatMoney(minor, doc.currency, locale);
  const method = doc.paidMethod ? METHOD[doc.paidMethod] : null;
  const property = [
    ar ? doc.propertyNameAr || doc.propertyNameEn : doc.propertyNameEn || doc.propertyNameAr,
    doc.unitCode,
  ]
    .filter(Boolean)
    .join(' · ');
  const issuer = doc.issuer;
  const signature = doc.signature;
  const issuerName = issuer ? (ar ? issuer.nameAr : issuer.nameEn) : 'BHD R';
  const title = ar ? 'إيصال استرداد مبلغ تأمين' : 'Deposit refund receipt';
  const titleAlt = ar ? 'Deposit refund receipt' : 'إيصال استرداد مبلغ تأمين';

  const rows: Array<{ labelAr: string; labelEn: string; value: string; strong?: boolean }> = [
    { labelAr: 'رقم الإيصال', labelEn: 'Receipt no.', value: doc.refundReceiptNo },
    { labelAr: 'التاريخ', labelEn: 'Date', value: stamp(doc.settledOn, ar) },
    { labelAr: 'الحجز', labelEn: 'Booking', value: doc.referenceCode },
    { labelAr: 'العقار', labelEn: 'Property', value: property || '—' },
    { labelAr: 'الضيف', labelEn: 'Guest', value: doc.guestName || '—' },
    {
      labelAr: 'مبلغ التأمين المستلم',
      labelEn: 'Deposit received',
      value: money(doc.depositMinor),
    },
    {
      labelAr: 'المبلغ المُسترد للضيف',
      labelEn: 'Refunded to the guest',
      value: money(doc.refundedMinor),
      strong: true,
    },
    {
      labelAr: 'طريقة التحويل',
      labelEn: 'Method',
      value: method ? (ar ? method.ar : method.en) : '—',
    },
    {
      labelAr: 'حُوّل إلى',
      labelEn: 'Paid to',
      value:
        [doc.paidBank, doc.paidAccountMasked, doc.paidHolder].filter(Boolean).join(' · ') || '—',
    },
    {
      labelAr: 'مرجع التحويل',
      labelEn: 'Transfer reference',
      value: doc.paidReference || '—',
    },
    { labelAr: 'تاريخ التحويل', labelEn: 'Transferred at', value: stamp(doc.paidAt, ar) },
  ];
  if (doc.retainedMinor) {
    rows.push({
      labelAr: 'المخصوم دخلاً للعقار',
      labelEn: 'Kept as property income',
      value: `${money(doc.retainedMinor)}${doc.incomeReceiptNo ? ` · ${doc.incomeReceiptNo}` : ''}`,
    });
  }
  rows.push(
    { labelAr: 'ملاحظة الاسترداد', labelEn: 'Refund note', value: doc.decisionNote || '—' },
    { labelAr: 'اعتمده', labelEn: 'Approved by', value: doc.decidedBy || '—' },
    {
      labelAr: 'سجّل التحويل',
      labelEn: 'Transfer recorded by',
      value: doc.paidBy || '—',
    },
  );

  return (
    <article
      className="rent-doc rent-doc--receipt stay-deposit-settlement-doc"
      id="stay-deposit-settlement"
      dir={ar ? 'rtl' : 'ltr'}
      lang={locale === 'en' ? 'en' : 'ar'}
      aria-label={doc.refundReceiptNo}
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
              <dd dir="ltr">{doc.refundReceiptNo}</dd>
            </div>
            <div>
              <dt>{ar ? 'التاريخ' : 'Date'}</dt>
              <dd>{stamp(doc.settledOn, ar)}</dd>
            </div>
          </dl>
        </div>
      </header>

      <p className="rent-doc__lead">
        {ar
          ? 'مستند محاسبي لعكس معاملة التأمين بعد التحويل — صادر بترويسة الشركة وموقّع إلكترونياً.'
          : 'Accounting reverse document for the deposit after transfer — issued on the company letterhead and electronically signed.'}
      </p>

      <p className="rent-doc__stamp rent-doc__stamp--paid" style={{ margin: '0 0 0.75rem' }}>
        {ar ? 'تم الاسترداد' : 'Refunded'}
      </p>

      <dl className="rent-doc__parties">
        {rows.map((row) => (
          <div key={row.labelEn} className={row.strong ? 'is-strong' : undefined}>
            <dt>{ar ? row.labelAr : row.labelEn}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="rent-doc__total">
        <span>{ar ? 'المبلغ المُسترد' : 'Amount refunded'}</span>
        <strong dir="ltr">{money(doc.refundedMinor)}</strong>
      </div>

      <p className="stay-deposit-settlement-doc__reconcile">
        {doc.incomeReceiptNo
          ? ar
            ? `هذا الإيصال مرتبط بالإيصال ${doc.incomeReceiptNo}، ومعاً يكمّلان مبلغ التأمين المستلم ${money(doc.depositMinor)}.`
            : `Linked to receipt ${doc.incomeReceiptNo}; together they account for the ${money(doc.depositMinor)} deposit received.`
          : ar
            ? `استُرد مبلغ التأمين المستلم ${money(doc.depositMinor)} كاملاً للضيف دون خصم.`
            : `The whole ${money(doc.depositMinor)} deposit was refunded without deduction.`}
      </p>

      {signature ? (
        <section
          className="rent-doc__sign"
          aria-label={ar ? 'الاعتماد الإلكتروني' : 'Electronic approval'}
        >
          <div
            className="rent-doc__qr"
            role="img"
            aria-label={ar ? 'باركود التحقق من المستند' : 'Document verification barcode'}
            dangerouslySetInnerHTML={{ __html: signature.qrSvg }}
          />
          <div className="rent-doc__sign-body">
            <h2>
              <span aria-hidden="true">✓ </span>
              {ar ? 'معتمد إلكترونياً' : 'Electronically approved'}
            </h2>
            <dl>
              <div>
                <dt>{ar ? 'الجهة' : 'Issuer'}</dt>
                <dd>
                  {ar
                    ? `${issuerName} — عبر منصة BHD R`
                    : `${issuerName} — via the BHD R platform`}
                </dd>
              </div>
              <div>
                <dt>{ar ? 'تاريخ الاعتماد' : 'Approved at'}</dt>
                <dd>{stampOf(signature.signedAt, ar)}</dd>
              </div>
              <div>
                <dt>{ar ? 'رمز الاعتماد' : 'Approval code'}</dt>
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
                ? 'للتحقق امسح الباركود أو افتح الرابط:'
                : 'To verify, scan the barcode or open:'}{' '}
              <bdi dir="ltr" className="rent-doc__url">
                {signature.verifyUrl}
              </bdi>
            </p>
          </div>
        </section>
      ) : null}

      <footer className="rent-doc__foot">
        {ar
          ? 'مستند محاسبي إلكتروني صادر وموقّع من منصة BHD R نيابةً عن المنشأة؛ لا يحتاج إلى ختم أو توقيع يدوي. أي تعديل على بياناته يُبطل التحقق منه.'
          : 'An electronic accounting document issued and signed by BHD R on behalf of the organization; it needs no stamp or handwritten signature. Any change to its contents voids verification.'}
      </footer>
    </article>
  );
}
