import { formatMoney } from '@/lib/format';
import { rentMonthLabel, rentPaymentMethodLabel } from '@/lib/rent-documents';
import type { RentDocument } from '@/lib/rent-documents-neon';

const BRAND_LOGO = '/brand/bhd-official-symbol.svg';

function dayOf(value: string | null | undefined, ar: boolean): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: value.length === 10 ? 'UTC' : 'Asia/Muscat',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function stampOf(value: string, ar: boolean): string {
  return new Date(value).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function muscatToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' });
}

function daysLate(dueOn: string): number {
  return Math.max(
    0,
    Math.round(
      (Date.parse(`${muscatToday()}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / 86_400_000,
    ),
  );
}

/**
 * A rent receipt or demand invoice laid out for A4: letterhead, parties, the installment with the
 * month it is for, what was paid or is due, and the electronic signature with its QR code.
 */
export function RentDocumentView({ doc, locale }: { doc: RentDocument; locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const { subject } = doc;
  const money = (minor: string) => formatMoney(minor, doc.currency, locale);
  const receipt = doc.kind === 'receipt';
  const month = rentMonthLabel(subject, ar);
  const late = !receipt ? daysLate(subject.dueOn) : 0;
  const issuerName = ar ? doc.issuer.nameAr : doc.issuer.nameEn;
  const propertyName = ar ? doc.property?.nameAr : doc.property?.nameEn;
  const unitName = ar ? doc.unit?.nameAr : doc.unit?.nameEn;
  const place =
    propertyName && unitName?.includes(propertyName)
      ? unitName
      : [propertyName, unitName].filter(Boolean).join(' — ');
  const installment =
    subject.index && doc.lease.installments && (subject.kind === 'rent' || subject.kind === 'vat')
      ? ar
        ? `القسط ${subject.index} من ${doc.lease.installments}`
        : `Installment ${subject.index} of ${doc.lease.installments}`
      : null;
  const stamp = receipt
    ? subject.settled
      ? ar
        ? 'مدفوع بالكامل'
        : 'Paid in full'
      : ar
        ? 'مدفوع جزئياً'
        : 'Part paid'
    : late
      ? ar
        ? 'متأخر السداد'
        : 'Overdue'
      : ar
        ? 'مستحق السداد'
        : 'Payment due';
  const contractLine = doc.contractReference
    ? ar
      ? ` بموجب عقد الإيجار رقم ${doc.contractReference}`
      : ` under lease contract ${doc.contractReference}`
    : '';

  return (
    <article
      className={`rent-doc rent-doc--${doc.kind}`}
      dir={ar ? 'rtl' : 'ltr'}
      lang={locale}
      aria-label={doc.number}
    >
      <header className="rent-doc__head">
        <div className="rent-doc__issuer">
          <img src={doc.issuer.logoDataUrl || BRAND_LOGO} alt="" width={132} height={52} />
          <div>
            <strong>{issuerName}</strong>
            {doc.issuer.nameEn !== doc.issuer.nameAr ? (
              <span lang={ar ? 'en' : 'ar'} dir={ar ? 'ltr' : 'rtl'}>
                {ar ? doc.issuer.nameEn : doc.issuer.nameAr}
              </span>
            ) : null}
            {doc.issuer.phone ? <small dir="ltr">{doc.issuer.phone}</small> : null}
          </div>
        </div>
        <div className="rent-doc__title">
          <h1>
            {receipt
              ? ar
                ? 'إيصال قبض'
                : 'Payment receipt'
              : ar
                ? 'فاتورة مطالبة'
                : 'Payment demand'}
          </h1>
          <span className="rent-doc__title-alt" lang={ar ? 'en' : 'ar'}>
            {receipt
              ? ar
                ? 'PAYMENT RECEIPT'
                : 'إيصال قبض'
              : ar
                ? 'PAYMENT DEMAND INVOICE'
                : 'فاتورة مطالبة'}
          </span>
          <dl>
            <div>
              <dt>
                {receipt
                  ? ar
                    ? 'رقم الإيصال'
                    : 'Receipt No.'
                  : ar
                    ? 'رقم الفاتورة'
                    : 'Invoice No.'}
              </dt>
              <dd dir="ltr">{doc.number}</dd>
            </div>
            <div>
              <dt>{ar ? 'تاريخ الإصدار' : 'Issued'}</dt>
              <dd>{dayOf(doc.issuedAt, ar)}</dd>
            </div>
          </dl>
        </div>
      </header>

      <p
        className={`rent-doc__stamp rent-doc__stamp--${receipt ? (subject.settled ? 'paid' : 'part') : late ? 'late' : 'due'}`}
      >
        {stamp}
      </p>

      <p className="rent-doc__lead">
        {receipt
          ? ar
            ? `استلمنا من السيد/ة ${doc.tenantName} مبلغ ${money(subject.paidMinor)} عن ${subject.label.ar} لشهر ${month}${contractLine}.`
            : `Received from ${doc.tenantName} the sum of ${money(subject.paidMinor)} for ${subject.label.en}, ${month}${contractLine}.`
          : ar
            ? `نطالب السيد/ة ${doc.tenantName} بسداد مبلغ ${money(subject.outstandingMinor)} عن ${subject.label.ar} لشهر ${month}${contractLine}، في موعد أقصاه ${dayOf(subject.dueOn, ar)}.`
            : `${doc.tenantName} is asked to pay ${money(subject.outstandingMinor)} for ${subject.label.en}, ${month}${contractLine}, by ${dayOf(subject.dueOn, ar)}.`}
      </p>

      <dl className="rent-doc__parties">
        <div>
          <dt>{ar ? 'المؤجر' : 'Landlord'}</dt>
          <dd>{issuerName}</dd>
        </div>
        <div>
          <dt>{ar ? 'المستأجر' : 'Tenant'}</dt>
          <dd>
            <bdi>{doc.tenantName}</bdi>
          </dd>
        </div>
        <div>
          <dt>{ar ? 'العقار والوحدة' : 'Property & unit'}</dt>
          <dd>
            {place || '—'}
            {doc.unit?.code && !place.includes(doc.unit.code) ? (
              <bdi dir="ltr"> ({doc.unit.code})</bdi>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>{ar ? 'رقم العقد' : 'Contract No.'}</dt>
          <dd dir="ltr">{doc.contractReference ?? '—'}</dd>
        </div>
        <div>
          <dt>{ar ? 'مدة العقد' : 'Lease term'}</dt>
          <dd>
            {dayOf(doc.lease.startsOn, ar)} {ar ? '←' : '→'} {dayOf(doc.lease.endsOn, ar)}
          </dd>
        </div>
        <div>
          <dt>{ar ? 'الإيجار الشهري' : 'Monthly rent'}</dt>
          <dd>{money(doc.lease.rentMinor)}</dd>
        </div>
      </dl>

      <table className="rent-doc__items">
        <thead>
          <tr>
            <th>{ar ? 'البيان' : 'Item'}</th>
            <th>{ar ? 'عن شهر' : 'For month'}</th>
            <th>{ar ? 'الفترة' : 'Period'}</th>
            <th>{ar ? 'الاستحقاق' : 'Due'}</th>
            <th>{ar ? 'المبلغ' : 'Amount'}</th>
            <th>{ar ? 'المدفوع' : 'Paid'}</th>
            <th>{ar ? 'المتبقي' : 'Balance'}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>{ar ? subject.label.ar : subject.label.en}</strong>
              {installment ? <small>{installment}</small> : null}
              {doc.description && !doc.description.startsWith(subject.label.ar) ? (
                <small>{doc.description}</small>
              ) : null}
              {subject.chequeNumber ? (
                <small>
                  {ar ? 'شيك رقم ' : 'Cheque '}
                  <bdi dir="ltr">{subject.chequeNumber}</bdi>
                  {subject.bankName ? ` · ${subject.bankName}` : ''}
                </small>
              ) : null}
            </td>
            <td>
              <strong>{month}</strong>
            </td>
            <td>
              {subject.periodFrom && subject.periodTo
                ? `${dayOf(subject.periodFrom, ar)} – ${dayOf(subject.periodTo, ar)}`
                : '—'}
            </td>
            <td>{dayOf(subject.dueOn, ar)}</td>
            <td>{money(subject.amountMinor)}</td>
            <td>{subject.paidMinor !== '0' ? money(subject.paidMinor) : '—'}</td>
            <td>{money(subject.outstandingMinor)}</td>
          </tr>
        </tbody>
      </table>

      <div className="rent-doc__total">
        <span>
          {receipt
            ? ar
              ? 'المبلغ المستلم'
              : 'Amount received'
            : ar
              ? 'المبلغ المطلوب سداده'
              : 'Amount due'}
        </span>
        <strong>{money(receipt ? subject.paidMinor : subject.outstandingMinor)}</strong>
        {receipt && subject.outstandingMinor !== '0' ? (
          <small>
            {ar
              ? `المتبقي على هذا البند ${money(subject.outstandingMinor)}`
              : `${money(subject.outstandingMinor)} remains on this item`}
          </small>
        ) : null}
        {!receipt && late ? (
          <small>{ar ? `متأخر منذ ${late} يوماً` : `${late} days overdue`}</small>
        ) : null}
      </div>

      {receipt ? (
        <section className="rent-doc__payments">
          <h2>{ar ? 'تفاصيل الاستلام' : 'Payment details'}</h2>
          {doc.payments.length ? (
            <table>
              <thead>
                <tr>
                  <th>{ar ? 'التاريخ' : 'Date'}</th>
                  <th>{ar ? 'الطريقة' : 'Method'}</th>
                  <th>{ar ? 'المرجع' : 'Reference'}</th>
                  <th>{ar ? 'استلمها' : 'Received by'}</th>
                  <th>{ar ? 'المبلغ' : 'Amount'}</th>
                </tr>
              </thead>
              <tbody>
                {doc.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{stampOf(payment.receivedAt, ar)}</td>
                    <td>{rentPaymentMethodLabel(payment.method, ar)}</td>
                    <td dir="ltr">{payment.reference ?? '—'}</td>
                    <td>{payment.recordedBy ?? '—'}</td>
                    <td>{money(payment.amountMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {doc.chequeClearedAt ? (
            <p>
              {ar
                ? `سُدّد بالشيك رقم ${subject.chequeNumber ?? '—'}${subject.bankName ? ` (${subject.bankName})` : ''}، وصُرف في ${dayOf(doc.chequeClearedAt, ar)}.`
                : `Paid by cheque ${subject.chequeNumber ?? '—'}${subject.bankName ? ` (${subject.bankName})` : ''}, cleared on ${dayOf(doc.chequeClearedAt, ar)}.`}
            </p>
          ) : null}
        </section>
      ) : (
        <section className="rent-doc__payments">
          <h2>{ar ? 'طريقة السداد' : 'How to pay'}</h2>
          <p>
            {ar
              ? 'يُرجى السداد لدى إدارة العقار أو بالطريقة المتفق عليها في العقد (شيك، تحويل بنكي، نقداً). بعد تسجيل السداد يصلك إيصال قبض موقّع إلكترونياً على بريدك، ويظهر في كشف حسابك.'
              : 'Please pay the property management or as agreed in the contract (cheque, bank transfer, cash). Once the payment is recorded you receive an electronically signed receipt by email and in your statement.'}
          </p>
          {subject.paidMinor !== '0' ? (
            <p>
              {ar
                ? `سبق أن سُدّد ${money(subject.paidMinor)} من هذا البند؛ المطلوب هو المتبقي فقط.`
                : `${money(subject.paidMinor)} of this item was already paid; only the balance is due.`}
            </p>
          ) : null}
        </section>
      )}

      <section
        className="rent-doc__sign"
        aria-label={ar ? 'التوقيع الإلكتروني' : 'Electronic signature'}
      >
        <div
          className="rent-doc__qr"
          role="img"
          aria-label={ar ? 'رمز التحقق من المستند' : 'Document verification code'}
          dangerouslySetInnerHTML={{ __html: doc.signature.qrSvg }}
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
                {ar ? `${issuerName} — عبر منصة BHD R` : `${issuerName} — via the BHD R platform`}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'تاريخ التوقيع' : 'Signed at'}</dt>
              <dd>{stampOf(doc.signature.signedAt, ar)}</dd>
            </div>
            <div>
              <dt>{ar ? 'رمز التوقيع' : 'Signature code'}</dt>
              <dd dir="ltr" className="rent-doc__code">
                {doc.signature.code}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'بصمة المستند (SHA-256)' : 'Document fingerprint (SHA-256)'}</dt>
              <dd dir="ltr" className="rent-doc__hash">
                {doc.signature.fingerprint}
              </dd>
            </div>
          </dl>
          <p>
            {ar
              ? 'للتحقق من صحة المستند امسح الرمز أو افتح الرابط:'
              : 'To verify this document, scan the code or open:'}{' '}
            <bdi dir="ltr" className="rent-doc__url">
              {doc.signature.verifyUrl}
            </bdi>
          </p>
        </div>
      </section>

      <footer className="rent-doc__foot">
        {ar
          ? 'مستند إلكتروني صادر وموقّع من منصة BHD R نيابةً عن المؤجر، ولا يحتاج إلى ختم أو توقيع يدوي. أي تعديل على بياناته يُبطل التحقق منه.'
          : 'An electronic document issued and signed by the BHD R platform on behalf of the landlord; it needs no stamp or handwritten signature. Any change to its contents voids its verification.'}
      </footer>
    </article>
  );
}
