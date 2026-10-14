import type { ReactNode } from 'react';
import { formatMoney } from '@/lib/format';
import { maskedPersonName, rentMonthLabel } from '@/lib/rent-documents';
import type { RentDocVerdict, RentDocVerification } from '@/lib/rent-documents-neon';

const BRAND_LOGO = '/brand/bhd-official-symbol.svg';

type Pair = readonly [string, string];

const VERDICTS: Record<RentDocVerdict, { icon: string; tone: string; title: Pair; note: Pair }> = {
  valid: {
    icon: '✓',
    tone: 'valid',
    title: ['مستند أصلي وموقّع إلكترونياً', 'Genuine, electronically signed document'],
    note: [
      'صدر هذا المستند من منصة BHD R، وبياناته مطابقة تماماً لسجلات المؤجر حتى هذه اللحظة.',
      'This document was issued by the BHD R platform and matches the landlord’s records exactly as of now.',
    ],
  },
  settled: {
    icon: '✓',
    tone: 'valid',
    title: ['فاتورة أصلية — سُدّدت بعد إصدارها', 'Genuine invoice — paid since it was issued'],
    note: [
      'صدرت هذه الفاتورة من المنصة، وقد سُدّد المبلغ المطلوب فيها بعد ذلك؛ لم يعد عليها شيء مستحق.',
      'This invoice was issued by the platform and has been paid since; nothing is due on it any more.',
    ],
  },
  changed: {
    icon: '!',
    tone: 'pending',
    title: [
      'مستند أصلي — تغيّرت بياناته منذ طباعته',
      'Genuine document — updated since it was printed',
    ],
    note: [
      'صدر هذا المستند من المنصة، لكن المبالغ تغيّرت بعد طباعته (دفعة جديدة مثلاً). المعتمد هو ما يظهر أدناه.',
      'This document was issued by the platform, but its amounts changed after it was printed (a new payment, for instance). What is shown below is current.',
    ],
  },
};

function Bi({ value, ar }: { value: Pair; ar: boolean }) {
  const [first, second] = ar ? value : [value[1], value[0]];
  return (
    <span className="verify-bi">
      <span>{first}</span>
      <small lang={ar ? 'en' : 'ar'} dir={ar ? 'ltr' : 'rtl'}>
        {second}
      </small>
    </span>
  );
}

function stamp(value: string, ar: boolean): string {
  return new Date(value).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Public check of a receipt or demand invoice: who issued it, the amount, the month, the status. */
export function RentDocumentVerifyView({
  result,
  locale,
}: {
  result: RentDocVerification | null;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  if (!result) {
    return (
      <main className="verify-page" dir={ar ? 'rtl' : 'ltr'}>
        <article className="verify-card verify-card--invalid">
          <div className="verify-card__status">
            <span className="verify-card__icon" aria-hidden="true">
              ✕
            </span>
            <h1>
              <Bi
                value={['لا يوجد مستند مطابق لهذا الرمز', 'No document matches this code']}
                ar={ar}
              />
            </h1>
          </div>
          <p className="verify-card__note">
            <Bi
              value={[
                'تأكد من مسح الرمز الموجود على الإيصال أو الفاتورة الأصلية. إن استمرت المشكلة فقد لا يكون المستند صادراً من المنصة.',
                'Make sure you scanned the code on the original receipt or invoice. If this persists, the document may not have been issued by the platform.',
              ]}
              ar={ar}
            />
          </p>
        </article>
      </main>
    );
  }
  const { document: doc, verdict } = result;
  const copy = VERDICTS[verdict];
  const receipt = doc.kind === 'receipt';
  const money = (minor: string) => formatMoney(minor, doc.currency, locale);
  const fact = (term: Pair, value: ReactNode) => (
    <div className="verify-fact">
      <dt>
        <Bi value={term} ar={ar} />
      </dt>
      <dd>{value}</dd>
    </div>
  );
  return (
    <main className="verify-page" dir={ar ? 'rtl' : 'ltr'}>
      <article className={`verify-card verify-card--${copy.tone}`}>
        <header className="verify-card__issuer">
          <img src={doc.issuer.logoDataUrl || BRAND_LOGO} alt="" width={120} height={48} />
          <div>
            <strong lang="ar" dir="rtl">
              {doc.issuer.nameAr}
            </strong>
            {doc.issuer.nameEn !== doc.issuer.nameAr ? (
              <span lang="en" dir="ltr">
                {doc.issuer.nameEn}
              </span>
            ) : null}
          </div>
        </header>
        <div className="verify-card__status">
          <span className="verify-card__icon" aria-hidden="true">
            {copy.icon}
          </span>
          <h1>
            <Bi value={copy.title} ar={ar} />
          </h1>
        </div>
        <p className="verify-card__note">
          <Bi value={copy.note} ar={ar} />
        </p>
        <p className="verify-card__statement">
          <Bi value={['رمز التوقيع الإلكتروني', 'Electronic signature code']} ar={ar} />
          <b dir="ltr">{doc.signature.code}</b>
        </p>
        <dl className="verify-card__facts">
          {fact(
            receipt
              ? ['إيصال قبض رقم', 'Receipt No.']
              : ['فاتورة مطالبة رقم', 'Demand invoice No.'],
            <bdi dir="ltr">{doc.number}</bdi>,
          )}
          {fact(
            ['البند', 'Item'],
            <Bi value={[doc.subject.label.ar, doc.subject.label.en]} ar={ar} />,
          )}
          {fact(
            ['عن شهر', 'For month'],
            <Bi
              value={[rentMonthLabel(doc.subject, true), rentMonthLabel(doc.subject, false)]}
              ar={ar}
            />,
          )}
          {fact(['قيمة البند', 'Item amount'], money(doc.subject.amountMinor))}
          {fact(['المدفوع', 'Paid'], money(doc.subject.paidMinor))}
          {fact(['المتبقي', 'Balance'], money(doc.subject.outstandingMinor))}
          {fact(
            ['الحالة', 'Status'],
            <Bi value={[doc.subject.status.ar, doc.subject.status.en]} ar={ar} />,
          )}
          {fact(['المستأجر', 'Tenant'], <bdi>{maskedPersonName(doc.tenantName)}</bdi>)}
          {doc.contractReference
            ? fact(['رقم العقد', 'Contract No.'], <bdi dir="ltr">{doc.contractReference}</bdi>)
            : null}
          {doc.property
            ? fact(
                ['العقار', 'Property'],
                <Bi value={[doc.property.nameAr, doc.property.nameEn]} ar={ar} />,
              )
            : null}
        </dl>
        <p className="verify-card__privacy">
          <span aria-hidden="true">🔒</span>
          <Bi
            value={[
              'حفاظاً على الخصوصية يظهر اسم المستأجر مختصراً، ولا تُعرض بيانات الاتصال أو الهوية.',
              'For privacy the tenant’s name is shortened, and no contact or ID details are shown.',
            ]}
            ar={ar}
          />
        </p>
        <footer className="verify-card__foot">
          <Bi
            value={[
              `تم التحقق في ${stamp(new Date().toISOString(), true)} · منصة BHD R`,
              `Checked on ${stamp(new Date().toISOString(), false)} · BHD R platform`,
            ]}
            ar={ar}
          />
        </footer>
      </article>
    </main>
  );
}
