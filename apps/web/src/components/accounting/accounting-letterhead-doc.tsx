import type { AccountingPrintDoc } from '@/lib/accounting-letterhead';

const BRAND_LOGO = '/brand/bhd-official-symbol.svg';

function stampOf(value: string, ar: boolean): string {
  return new Date(value).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Letterheaded accounting document (journal / invoice / receipt / report) with the same
 * bilingual layout and electronic signature block as rent receipts.
 */
export function AccountingLetterheadDoc({
  doc,
  locale,
}: {
  doc: AccountingPrintDoc;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const issuerName = ar ? doc.issuer.nameAr : doc.issuer.nameEn;
  const title = ar ? doc.titleAr : doc.titleEn;
  const titleAlt = ar ? doc.titleEn : doc.titleAr;

  return (
    <article
      className={`rent-doc rent-doc--${doc.kind === 'document' ? 'invoice' : 'receipt'} accounting-letterhead`}
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
            {doc.issuer.email ? <small dir="ltr">{doc.issuer.email}</small> : null}
            {doc.issuer.registrationNumber ? (
              <small dir="ltr">CR {doc.issuer.registrationNumber}</small>
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
              <dd dir="ltr">{doc.number}</dd>
            </div>
            <div>
              <dt>{ar ? 'التاريخ' : 'Date'}</dt>
              <dd>{doc.occurredOn}</dd>
            </div>
          </dl>
        </div>
      </header>

      <p className="rent-doc__lead">{doc.description}</p>

      <dl className="rent-doc__parties">
        {doc.meta.map((row) => (
          <div key={`${row.labelEn}-${row.value}`}>
            <dt>{ar ? row.labelAr : row.labelEn}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      {doc.lines.length ? (
        <table className="rent-doc__items">
          <thead>
            <tr>
              <th>{ar ? 'الحساب / البند' : 'Account / item'}</th>
              <th>{ar ? 'البُعد' : 'Dimension'}</th>
              <th>{ar ? 'ملاحظة' : 'Memo'}</th>
              <th>{ar ? 'مدين' : 'Debit'}</th>
              <th>{ar ? 'دائن' : 'Credit'}</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((line, index) => (
              <tr key={`${line.account}-${index}`}>
                <td>{line.account}</td>
                <td>{line.dimension}</td>
                <td>{line.memo}</td>
                <td dir="ltr">{line.debit}</td>
                <td dir="ltr">{line.credit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {doc.amountText !== '—' ? (
        <div className="rent-doc__total">
          <span>{ar ? 'الإجمالي' : 'Total'}</span>
          <strong dir="ltr">{doc.amountText}</strong>
        </div>
      ) : null}

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
          ? 'مستند محاسبي إلكتروني صادر وموقّع من منصة BHD R نيابةً عن الشركة، بنفس ترويسة الشركة المستخدمة في فواتير الإيجار. أي تعديل على بياناته يُبطل التحقق منه.'
          : 'An electronic accounting document issued and signed by the BHD R platform on behalf of the company, using the same letterhead as rent invoices. Any change to its contents voids its verification.'}
      </footer>
    </article>
  );
}
