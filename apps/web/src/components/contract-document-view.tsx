import { Card, CardContent } from '@bhd-r/ui';
import { Amiri } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { TermsDocument } from '@/components/terms-document';
import type { ContractDetail } from '@/lib/contract-detail-neon';
import type {
  ContractDocument,
  ContractFileKind,
  ContractPartyCard,
  ContractPremises,
} from '@/lib/contract-document';
import { formatMoney } from '@/lib/format';
import type { PortalRole } from '@/lib/types';
import { stayTypeLabel } from '@/lib/ui-labels';
import { ContractActions } from './contract-actions';
import { ContractDocumentToolbar } from './contract-document-toolbar';
import { SignatureForm } from './signature-form';

const contractSerif = Amiri({
  subsets: ['arabic', 'latin'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-contract',
});

type Portal = Exclude<PortalRole, 'platform'>;

const DOCUMENT_ID = 'contract-document';
const BRAND_LOGO = '/brand/bhd-official-symbol.svg';

type Pair = [string, string];

const STATUS_LABELS: Record<string, Pair> = {
  draft: ['مسودة', 'Draft'],
  sent: ['مُرسل للتوقيع', 'Sent for signature'],
  partially_signed: ['موقّع جزئياً', 'Partially signed'],
  signed: ['موقّع ونافذ', 'Signed & in force'],
  void: ['ملغى', 'Void'],
  terminated: ['منتهٍ', 'Terminated'],
};

const SIGNATURE_METHODS: Record<string, Pair> = {
  system_on_approval: ['توقيع عند الاعتماد في المنصة', 'Signed on approval in the platform'],
  booking_terms_acceptance: [
    'قبول الشروط عند الحجز مع توقيع إلكتروني',
    'Terms accepted at booking with e-signature',
  ],
  booking_confirmation: ['تأكيد الحجز', 'Booking confirmation'],
};

const FILE_LABELS: Record<ContractFileKind, Pair> = {
  signature: ['توقيع الضيف الإلكتروني', 'Guest e-signature'],
  'id-front': ['الهوية — الوجه الأمامي', 'ID — front'],
  'id-back': ['الهوية — الوجه الخلفي', 'ID — back'],
  selfie: ['صورة شخصية للتحقق', 'Verification selfie'],
};

/** Arabic counted noun: one / two / 3–10 plural / 11+ singular accusative. */
function arCount(count: number, forms: [string, string, string, string]): string {
  if (count === 1) return forms[0];
  if (count === 2) return forms[1];
  return ` ${count <= 10 ? forms[2] : forms[3]}`;
}

const CATEGORIES: Record<string, Pair> = {
  apartment: ['شقة', 'Apartment'],
  villa: ['فيلا', 'Villa'],
  building: ['مبنى', 'Building'],
  office: ['مكتب', 'Office'],
  shop: ['محل تجاري', 'Shop'],
  warehouse: ['مستودع', 'Warehouse'],
  land: ['أرض', 'Land'],
  other: ['أخرى', 'Other'],
};

const FURNISHING: Record<string, Pair> = {
  unfurnished: ['غير مفروش', 'Unfurnished'],
  semi_furnished: ['مفروش جزئياً', 'Semi-furnished'],
  furnished: ['مفروش', 'Furnished'],
};

const ORDINALS_AR = [
  'أولاً',
  'ثانياً',
  'ثالثاً',
  'رابعاً',
  'خامساً',
  'سادساً',
  'سابعاً',
  'ثامناً',
  'تاسعاً',
  'عاشراً',
  'حادي عشر',
  'ثاني عشر',
  'ثالث عشر',
  'رابع عشر',
];

function label(map: Record<string, Pair>, key: string | null | undefined, ar: boolean) {
  if (!key) return null;
  const found = map[key];
  return found ? found[ar ? 0 : 1] : key;
}

function docTitle(doc: ContractDocument, contract: ContractDetail): Pair {
  if (contract.kind === 'renewal') return ['ملحق تجديد عقد', 'Contract Renewal Addendum'];
  if (doc.type === 'stay') return ['عقد إقامة قصيرة', 'Short-Stay Agreement'];
  if (doc.type === 'sale') return ['عقد بيع عقار', 'Property Sale Agreement'];
  return ['عقد إيجار', 'Lease Agreement'];
}

/** Empty contract field: a dotted line to fill in by hand, like a printed form. */
function Value({ children }: { children: ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return empty ? <span className="contract-doc__blank" aria-label="—" /> : <>{children}</>;
}

function Row({ term, children, wide }: { term: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`contract-doc__row${wide ? ' contract-doc__row--wide' : ''}`}>
      <dt>{term}</dt>
      <dd>
        <Value>{children}</Value>
      </dd>
    </div>
  );
}

function Ltr({ children }: { children: string | null | undefined }) {
  return children ? <bdi dir="ltr">{children}</bdi> : null;
}

export function ContractDocumentView({
  contract,
  doc,
  portal,
  locale,
  viewerName,
}: {
  contract: ContractDetail;
  doc: ContractDocument;
  portal: Portal;
  locale: 'ar' | 'en';
  viewerName: string;
}) {
  const ar = locale === 'ar';
  const intl = ar ? 'ar-OM' : 'en-OM';
  const dateTime = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleString(intl, {
          timeZone: 'Asia/Muscat',
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—';
  const day = (value: string | null | undefined) =>
    value
      ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value).toLocaleDateString(intl, {
          timeZone: value.length === 10 ? 'UTC' : 'Asia/Muscat',
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : '—';
  const money = (value: ContractDocument['amount']) =>
    value ? formatMoney(value.amountMinor, value.currency, locale) : null;

  const [titleAr, titleEn] = docTitle(doc, contract);
  const title = ar ? titleAr : titleEn;
  const stay = doc.type === 'stay';
  const sale = doc.type === 'sale';
  const owner = doc.owner;
  const tenant = doc.tenant;
  const ownerName = owner?.name ?? contract.parties.owner?.displayName ?? '—';
  const tenantName = tenant?.name ?? contract.parties.tenant?.displayName ?? '—';
  const premises = doc.premises;
  const propertyName = premises
    ? ar
      ? premises.propertyNameAr
      : premises.propertyNameEn
    : contract.property
      ? ar
        ? contract.property.nameAr
        : contract.property.nameEn
      : '—';
  const unitName = premises?.unit
    ? `${premises.unit.code} · ${ar ? premises.unit.nameAr : premises.unit.nameEn}`
    : contract.unit
      ? `${contract.unit.code} · ${ar ? contract.unit.nameAr : contract.unit.nameEn}`
      : '—';
  const status = label(STATUS_LABELS, contract.status, ar) ?? contract.status;
  const fileUrl = (kind: ContractFileKind) =>
    `/api/portal/contracts/${contract.id}/files/${kind}?portal=${portal}`;
  const signatureImage = doc.files.some((file) => file.kind === 'signature')
    ? fileUrl('signature')
    : null;
  const attachments = doc.files.filter((file) => file.kind !== 'signature');
  const recipientPath = stay
    ? doc.stay?.guestPageHref
      ? `/${locale}${doc.stay.guestPageHref}`
      : null
    : `/${locale}/tenant/contracts/${contract.id}`;
  const summary = ar
    ? `${ownerName} ← ${tenantName} · ${propertyName} (${unitName}) · من ${day(contract.startsOn)} إلى ${day(contract.endsOn)} · القيمة ${money(doc.amount) ?? '—'}`
    : `${ownerName} → ${tenantName} · ${propertyName} (${unitName}) · ${day(contract.startsOn)} – ${day(contract.endsOn)} · ${money(doc.amount) ?? '—'}`;

  const letterhead = doc.letterhead;
  const companyAr = letterhead?.nameAr || ownerName;
  const companyEn = letterhead?.nameEn || ownerName;
  const contactLine = [
    letterhead?.phone || owner?.phone || null,
    letterhead?.email || owner?.email || null,
    letterhead?.registrationNumber ? `CR ${letterhead.registrationNumber}` : null,
  ].filter((part): part is string => Boolean(part));
  const firstRole = sale ? (ar ? 'البائع' : 'Seller') : ar ? 'المؤجر' : 'Landlord';
  const secondRole = stay
    ? ar
      ? 'الضيف المستأجر'
      : 'Guest'
    : sale
      ? ar
        ? 'المشتري'
        : 'Buyer'
      : ar
        ? 'المستأجر'
        : 'Tenant';

  const timeline = [
    { at: doc.createdAt, text: ar ? 'تحرير العقد' : 'Contract drawn up' },
    ...(doc.approval?.at
      ? [
          {
            at: doc.approval.at,
            text: ar
              ? `اعتمده ${doc.approval.byName ?? 'المؤجر'}`
              : `Approved by ${doc.approval.byName ?? 'the landlord'}`,
          },
        ]
      : []),
    ...(doc.sentAt ? [{ at: doc.sentAt, text: ar ? 'أُرسل للتوقيع' : 'Sent for signature' }] : []),
    ...(doc.termsAcceptedAt
      ? [
          {
            at: doc.termsAcceptedAt,
            text: ar ? 'قبل الطرف الثاني الشروط' : 'Second party accepted the terms',
          },
        ]
      : []),
    ...doc.signatures.map((signature) => ({
      at: signature.signedAt,
      text: ar
        ? `وقّع ${signature.role === 'owner' ? 'الطرف الأول' : 'الطرف الثاني'}${signature.name ? ` (${signature.name})` : ''}`
        : `${signature.role === 'owner' ? 'First' : 'Second'} party signed${signature.name ? ` (${signature.name})` : ''}`,
    })),
    ...(doc.stay?.checkIn
      ? [{ at: doc.stay.checkIn.at, text: ar ? 'تسلّم العين المؤجرة' : 'Premises handed over' }]
      : []),
    ...(doc.stay?.checkOut
      ? [{ at: doc.stay.checkOut.at, text: ar ? 'إعادة العين المؤجرة' : 'Premises returned' }]
      : []),
    ...(doc.completedAt
      ? [{ at: doc.completedAt, text: ar ? 'اكتمل العقد' : 'Contract completed' }]
      : []),
  ].sort((left, right) => left.at.localeCompare(right.at));

  let index = 0;
  const heading = (text: string) => {
    index += 1;
    return (
      <h2 className="contract-doc__heading">
        <span className="contract-doc__ordinal">
          {ar ? (ORDINALS_AR[index - 1] ?? `${index}`) : `Article ${index}`}
        </span>
        <span>{text}</span>
      </h2>
    );
  };

  return (
    <div className="form-shell contract-detail contract-detail--document">
      <header className="portal-topbar contract-detail__topbar">
        <div>
          <span className="ops-kicker">BHD R · CONTRACT</span>
          <h1>{contract.reference}</h1>
          <p>
            {title} · {status}
          </p>
        </div>
        <Link className="button button--quiet" href={`/${locale}/${portal}/contracts`}>
          {ar ? 'كل العقود' : 'All contracts'}
        </Link>
      </header>

      <ContractDocumentToolbar
        ar={ar}
        documentId={DOCUMENT_ID}
        title={title}
        reference={contract.reference}
        summary={summary}
        recipient={
          portal === 'tenant'
            ? null
            : {
                name: tenantName,
                email: tenant?.email ?? doc.tenantContact?.email ?? null,
                phone: tenant?.phone ?? doc.tenantContact?.phone ?? null,
              }
        }
        recipientPath={portal === 'tenant' ? null : recipientPath}
        pdfUrl={contract.documentUrl}
      />

      {portal !== 'tenant' && !letterhead?.logoDataUrl ? (
        <p className="contract-doc-hint">
          {ar
            ? 'لإظهار شعار شركتك وعنوانها في ترويسة العقد بدلاً من شعار المنصة، أضفهما من '
            : 'To show your own logo and address in the contract header instead of the platform mark, add them in '}
          <Link href={`/${locale}/${portal === 'developer' ? 'developer' : 'owner'}/terms`}>
            {ar ? 'الشروط والترويسة' : 'Terms & letterhead'}
          </Link>
          .
        </p>
      ) : null}

      <article
        id={DOCUMENT_ID}
        className={`contract-doc ${contractSerif.variable}`}
        dir={ar ? 'rtl' : 'ltr'}
        lang={locale}
      >
        <div className="contract-doc__page-frame" aria-hidden="true" />
        <img
          className="contract-doc__watermark"
          src={letterhead?.logoDataUrl || BRAND_LOGO}
          alt=""
          aria-hidden="true"
        />
        <table className="contract-doc__frame">
          <thead>
            <tr>
              <td>
                <header className="contract-doc__letterhead">
                  <div className="contract-doc__lh-side" dir="rtl" lang="ar">
                    <strong>{companyAr}</strong>
                    {letterhead?.addressAr ? <span>{letterhead.addressAr}</span> : null}
                  </div>
                  <div className="contract-doc__lh-logo">
                    <img src={letterhead?.logoDataUrl || BRAND_LOGO} alt={companyEn} />
                  </div>
                  <div className="contract-doc__lh-side" dir="ltr" lang="en">
                    <strong>{companyEn}</strong>
                    {letterhead?.addressEn ? <span>{letterhead.addressEn}</span> : null}
                  </div>
                  {contactLine.length ? (
                    <div className="contract-doc__lh-contact" dir="ltr">
                      {contactLine.join('  ·  ')}
                    </div>
                  ) : null}
                </header>
              </td>
            </tr>
          </thead>
          <tfoot>
            <tr>
              <td>
                <footer className="contract-doc__pagefoot">
                  <span>
                    {title} · <bdi dir="ltr">{contract.reference}</bdi>
                  </span>
                  <span>
                    {[letterhead?.addressAr, letterhead?.phone, letterhead?.email]
                      .filter(Boolean)
                      .join(' · ') || (ar ? 'صدر إلكترونياً عبر BHD R' : 'Issued via BHD R')}
                  </span>
                </footer>
              </td>
            </tr>
          </tfoot>
          <tbody>
            <tr>
              <td>
                <div className="contract-doc__title">
                  <span className="contract-doc__ornament" aria-hidden="true">
                    ❖
                  </span>
                  <h1>{title}</h1>
                  <p className="contract-doc__title-alt" lang={ar ? 'en' : 'ar'}>
                    {ar ? titleEn : titleAr}
                  </p>
                  <div className="contract-doc__meta">
                    <div>
                      <span>{ar ? 'رقم العقد' : 'Contract No.'}</span>
                      <strong>
                        <bdi dir="ltr">{contract.reference}</bdi>
                      </strong>
                    </div>
                    <div>
                      <span>{ar ? 'تاريخ التحرير' : 'Date'}</span>
                      <strong>{day(doc.createdAt)}</strong>
                    </div>
                    <div>
                      <span>{ar ? 'حالة العقد' : 'Status'}</span>
                      <strong>{status}</strong>
                    </div>
                  </div>
                  <span
                    className={`contract-doc__seal contract-doc__seal--${contract.status}`}
                    aria-hidden="true"
                  >
                    <span>{status}</span>
                    <small>BHD R</small>
                  </span>
                </div>

                <p className="contract-doc__preamble">
                  {ar
                    ? `إنه في يوم ${day(doc.createdAt)}، حُرّر هذا العقد واتُّفق بين كلٍّ من:`
                    : `This agreement is made on ${day(doc.createdAt)} between:`}
                </p>

                <section className="contract-doc__section">
                  {heading(ar ? 'أطراف العقد' : 'The Parties')}
                  <div className="contract-doc__parties">
                    <PartyPlate
                      ar={ar}
                      order={ar ? 'الطرف الأول' : 'First Party'}
                      role={firstRole}
                      party={owner}
                      fallbackName={ownerName}
                      representative={
                        doc.approval?.byName && doc.approval.byName !== ownerName
                          ? doc.approval.byName
                          : null
                      }
                    />
                    <PartyPlate
                      ar={ar}
                      order={ar ? 'الطرف الثاني' : 'Second Party'}
                      role={secondRole}
                      party={tenant}
                      fallbackName={tenantName}
                      representative={null}
                    />
                  </div>
                  <p className="contract-doc__note-line">
                    {ar
                      ? 'وقد أقرّ الطرفان بأهليتهما للتعاقد، واتفقا على ما يلي:'
                      : 'Both parties, having full capacity to contract, agree as follows:'}
                  </p>
                </section>

                <section className="contract-doc__section">
                  {heading(
                    sale
                      ? ar
                        ? 'العقار المبيع'
                        : 'The Property'
                      : ar
                        ? 'العين المؤجَّرة'
                        : 'The Premises',
                  )}
                  <Premises premises={premises} ar={ar} propertyName={propertyName} />
                </section>

                <section className="contract-doc__section">
                  {heading(ar ? 'المدة والقيمة' : 'Term & Consideration')}
                  <dl className="contract-doc__table">
                    <Row term={ar ? 'تاريخ البدء' : 'Commencement'}>{day(contract.startsOn)}</Row>
                    <Row term={ar ? 'تاريخ الانتهاء' : 'Expiry'}>{day(contract.endsOn)}</Row>
                    {doc.stay?.nights ? (
                      <Row term={ar ? 'عدد الليالي' : 'Nights'}>{doc.stay.nights}</Row>
                    ) : null}
                    {doc.stay && (doc.stay.adults || doc.stay.children) ? (
                      <Row term={ar ? 'عدد الضيوف' : 'Guests'}>
                        {ar
                          ? [
                              doc.stay.adults
                                ? arCount(doc.stay.adults, [
                                    'بالغ واحد',
                                    'بالغان',
                                    'بالغين',
                                    'بالغاً',
                                  ])
                                : null,
                              doc.stay.children
                                ? arCount(doc.stay.children, [
                                    'طفل واحد',
                                    'طفلان',
                                    'أطفال',
                                    'طفلاً',
                                  ])
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' و')
                          : `${doc.stay.adults ?? 0} adult(s)${doc.stay.children ? `, ${doc.stay.children} child(ren)` : ''}`}
                      </Row>
                    ) : null}
                    {doc.stayType ? (
                      <Row term={ar ? 'نوع الإقامة' : 'Stay type'}>
                        {stayTypeLabel(doc.stayType, locale)}
                      </Row>
                    ) : null}
                    <Row
                      term={
                        stay
                          ? ar
                            ? 'قيمة الإقامة'
                            : 'Stay amount'
                          : sale
                            ? ar
                              ? 'ثمن البيع'
                              : 'Price'
                            : ar
                              ? 'القيمة الإيجارية'
                              : 'Rent'
                      }
                    >
                      {money(doc.amount)}
                    </Row>
                    <Row term={ar ? 'مبلغ التأمين' : 'Security deposit'}>
                      {money(doc.deposit) ?? (ar ? 'لا يوجد' : 'None')}
                    </Row>
                    {doc.source?.referenceCode ? (
                      <Row term={ar ? 'مرجع الحجز' : 'Booking reference'}>
                        <Ltr>{doc.source.referenceCode}</Ltr>
                      </Row>
                    ) : null}
                  </dl>
                </section>

                {doc.stay ? (
                  <section className="contract-doc__section">
                    {heading(ar ? 'التسليم والاستلام' : 'Handover')}
                    <dl className="contract-doc__table">
                      <Row term={ar ? 'تسلّم الضيف العين' : 'Checked in'}>
                        {doc.stay.checkIn ? (
                          <>
                            {dateTime(doc.stay.checkIn.at)}
                            {doc.stay.checkIn.notes ? (
                              <span className="contract-doc__note">{doc.stay.checkIn.notes}</span>
                            ) : null}
                          </>
                        ) : null}
                      </Row>
                      <Row term={ar ? 'أعاد الضيف العين' : 'Checked out'}>
                        {doc.stay.checkOut ? (
                          <>
                            {dateTime(doc.stay.checkOut.at)}
                            {doc.stay.checkOut.notes ? (
                              <span className="contract-doc__note">{doc.stay.checkOut.notes}</span>
                            ) : null}
                          </>
                        ) : null}
                      </Row>
                    </dl>
                  </section>
                ) : null}

                {doc.templateHtml ? (
                  <section className="contract-doc__section">
                    {heading(ar ? 'نص العقد' : 'Contract Text')}
                    <div
                      className="contract-doc__template"
                      dangerouslySetInnerHTML={{ __html: doc.templateHtml }}
                    />
                  </section>
                ) : null}

                <section className="contract-doc__section">
                  {heading(ar ? 'الشروط والأحكام' : 'Terms & Conditions')}
                  {doc.terms.length ? (
                    <>
                      {doc.termsAcceptedAt ? (
                        <p className="contract-doc__lead">
                          {ar
                            ? `وافق الطرف الثاني على الشروط التالية بتاريخ ${dateTime(doc.termsAcceptedAt)}.`
                            : `The second party accepted the following terms on ${dateTime(doc.termsAcceptedAt)}.`}
                        </p>
                      ) : null}
                      <TermsDocument blocks={doc.terms} />
                    </>
                  ) : (
                    <p className="muted">
                      {ar
                        ? 'تسري الشروط الواردة في نص العقد أعلاه.'
                        : 'The terms in the contract text above apply.'}
                    </p>
                  )}
                </section>

                <section className="contract-doc__section contract-doc__section--signatures">
                  {heading(ar ? 'التواقيع' : 'Signatures')}
                  <p className="contract-doc__lead">
                    {ar
                      ? 'وإثباتاً لما تقدّم، وقّع الطرفان على هذا العقد إلكترونياً، ولكلٍّ منهما نسخة مطابقة للأصل.'
                      : 'In witness whereof, the parties have signed this agreement electronically; each holds an identical copy.'}
                  </p>
                  <div className="contract-doc__signatures">
                    {(['owner', 'tenant'] as const).map((side) => {
                      const signature = doc.signatures.find((row) =>
                        side === 'owner' ? row.role === 'owner' : row.role !== 'owner',
                      );
                      return (
                        <div key={side} className="contract-doc__signature">
                          <span className="contract-doc__party-role">
                            {side === 'owner'
                              ? `${ar ? 'الطرف الأول' : 'First Party'} — ${firstRole}`
                              : `${ar ? 'الطرف الثاني' : 'Second Party'} — ${secondRole}`}
                          </span>
                          <div className="contract-doc__signature-mark">
                            {signature && side === 'tenant' && signatureImage ? (
                              <img src={signatureImage} alt={ar ? 'التوقيع' : 'Signature'} />
                            ) : signature ? (
                              <span className="contract-doc__signature-seal">
                                {ar ? 'موقّع إلكترونياً' : 'Signed electronically'}
                              </span>
                            ) : null}
                          </div>
                          <dl className="contract-doc__signature-facts">
                            <Row term={ar ? 'الاسم' : 'Name'}>
                              {signature?.name ?? (side === 'owner' ? ownerName : tenantName)}
                            </Row>
                            <Row term={ar ? 'التاريخ' : 'Date'}>
                              {signature ? dateTime(signature.signedAt) : null}
                            </Row>
                            {signature ? (
                              <Row term={ar ? 'الطريقة' : 'Method'}>
                                {label(SIGNATURE_METHODS, signature.method, ar)}
                              </Row>
                            ) : null}
                          </dl>
                          {signature ? (
                            <code className="contract-doc__hash" dir="ltr">
                              {signature.hash}
                            </code>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="contract-doc__section">
                  {heading(ar ? 'المرفقات والوثائق' : 'Annexes & Documents')}
                  {attachments.length || contract.documentUrl ? (
                    <ul className="contract-doc__files">
                      {attachments.map((file) => (
                        <li key={file.kind}>
                          <a href={fileUrl(file.kind)} target="_blank" rel="noreferrer">
                            <img
                              src={fileUrl(file.kind)}
                              alt={label(FILE_LABELS, file.kind, ar) ?? file.kind}
                              loading="lazy"
                            />
                            <span>{label(FILE_LABELS, file.kind, ar)}</span>
                          </a>
                          {file.signedAt ? (
                            <small className="muted">{dateTime(file.signedAt)}</small>
                          ) : null}
                        </li>
                      ))}
                      {contract.documentUrl ? (
                        <li className="contract-doc__file-pdf">
                          <a href={contract.documentUrl} target="_blank" rel="noopener noreferrer">
                            <span className="contract-doc__pdf-icon">PDF</span>
                            <span>{ar ? 'النسخة المختومة من العقد' : 'Sealed contract copy'}</span>
                          </a>
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <p className="muted">
                      {doc.files.length
                        ? ar
                          ? 'وثائق الهوية متاحة لمن يملك صلاحية إدارة الحجوزات فقط.'
                          : 'ID documents are visible only to booking managers.'
                        : ar
                          ? 'لا توجد مرفقات.'
                          : 'No annexes.'}
                    </p>
                  )}
                </section>

                <section className="contract-doc__section">
                  {heading(ar ? 'الملاحق' : 'Addenda')}
                  {doc.parent ? (
                    <p>
                      {ar ? 'هذا ملحق للعقد الأصلي ' : 'This is an addendum to '}
                      <Link href={`/${locale}/${portal}/contracts/${doc.parent.id}`}>
                        <bdi dir="ltr">{doc.parent.reference}</bdi>
                      </Link>
                    </p>
                  ) : null}
                  {doc.addenda.length ? (
                    <ul className="contract-doc__addenda">
                      {doc.addenda.map((addendum) => (
                        <li key={addendum.id}>
                          <Link href={`/${locale}/${portal}/contracts/${addendum.id}`}>
                            <bdi dir="ltr">{addendum.reference}</bdi>
                          </Link>
                          <span>
                            {addendum.kind === 'renewal'
                              ? ar
                                ? 'تجديد'
                                : 'Renewal'
                              : addendum.kind}
                          </span>
                          <span>{label(STATUS_LABELS, addendum.status, ar)}</span>
                          <span>{day(addendum.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : doc.parent ? null : (
                    <p className="muted">{ar ? 'لا توجد ملاحق لهذا العقد.' : 'No addenda.'}</p>
                  )}
                </section>

                <section className="contract-doc__section">
                  {heading(ar ? 'سجل العقد' : 'Contract Record')}
                  <ol className="contract-doc__timeline">
                    {timeline.map((event, position) => (
                      <li key={`${event.at}-${position}`}>
                        <time dateTime={event.at}>{dateTime(event.at)}</time>
                        <span>{event.text}</span>
                      </li>
                    ))}
                  </ol>
                </section>

                <div className="contract-doc__integrity">
                  <span>
                    {ar
                      ? 'صدرت هذه الوثيقة إلكترونياً عبر منصة BHD R، والتواقيع أعلاه موثّقة ببصمات رقمية لا تقبل التعديل.'
                      : 'Issued electronically via BHD R; the signatures above are sealed with tamper-evident digital fingerprints.'}
                  </span>
                  {contract.documentHash ? (
                    <code dir="ltr">SHA-256 {contract.documentHash}</code>
                  ) : null}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </article>

      {portal !== 'tenant' ? (
        <Card className="contract-detail__manage">
          <CardContent>
            <h2>{ar ? 'إدارة العقد' : 'Manage contract'}</h2>
            <p>
              {ar ? 'حالة الاعتماد: ' : 'Approval status: '}
              <strong>
                {contract.approval?.status ??
                  (doc.approval ? (ar ? 'معتمد' : 'approved') : ar ? 'غير مطلوب' : 'Not requested')}
              </strong>
            </p>
            <ContractActions
              contractId={contract.id}
              status={contract.status}
              approvalStatus={contract.approval?.status ?? null}
              locale={locale}
            />
          </CardContent>
        </Card>
      ) : null}

      {contract.canSign ? (
        <SignatureForm contractId={contract.id} expectedName={viewerName} />
      ) : null}
    </div>
  );
}

function PartyPlate({
  ar,
  order,
  role,
  party,
  fallbackName,
  representative,
}: {
  ar: boolean;
  order: string;
  role: string;
  party: ContractPartyCard | null;
  fallbackName: string;
  representative: string | null;
}) {
  const company = party?.entityType === 'company';
  return (
    <div className="contract-doc__party">
      <div className="contract-doc__party-band">
        <strong>{order}</strong>
        <span>{role}</span>
      </div>
      <dl className="contract-doc__party-facts">
        <Row term={company ? (ar ? 'اسم الشركة' : 'Company') : ar ? 'الاسم' : 'Name'}>
          {party?.name ?? fallbackName}
        </Row>
        <Row term={ar ? 'الصفة' : 'Capacity'}>
          {company ? (ar ? 'شخص اعتباري' : 'Legal entity') : ar ? 'شخص طبيعي' : 'Individual'}
        </Row>
        {company ? (
          <>
            <Row term={ar ? 'السجل التجاري' : 'CR number'}>
              <Ltr>{party?.crNumber}</Ltr>
            </Row>
            <Row term={ar ? 'المفوّض بالتوقيع' : 'Authorised signatory'}>
              {party?.signatoryName}
            </Row>
            <Row term={ar ? 'رقمه المدني' : 'Signatory civil ID'}>
              <Ltr>{party?.signatoryCivilId}</Ltr>
            </Row>
          </>
        ) : (
          <>
            <Row term={ar ? 'الرقم المدني' : 'Civil ID'}>
              <Ltr>{party?.civilId}</Ltr>
            </Row>
            {party?.passport ? (
              <Row term={ar ? 'رقم الجواز' : 'Passport'}>
                <Ltr>{party.passport}</Ltr>
              </Row>
            ) : null}
            {party?.nationality ? (
              <Row term={ar ? 'الجنسية' : 'Nationality'}>{party.nationality}</Row>
            ) : null}
          </>
        )}
        <Row term={ar ? 'الهاتف' : 'Phone'}>
          <Ltr>{party?.phone}</Ltr>
        </Row>
        <Row term={ar ? 'البريد الإلكتروني' : 'Email'}>
          <Ltr>{party?.email}</Ltr>
        </Row>
        {representative ? (
          <Row term={ar ? 'يمثّله في الاعتماد' : 'Represented by'}>{representative}</Row>
        ) : null}
      </dl>
    </div>
  );
}

function Premises({
  premises,
  ar,
  propertyName,
}: {
  premises: ContractPremises | null;
  ar: boolean;
  propertyName: string;
}) {
  if (!premises) {
    return (
      <dl className="contract-doc__table">
        <Row term={ar ? 'العقار' : 'Property'}>{propertyName}</Row>
      </dl>
    );
  }
  const unit = premises.unit;
  const addressLine = [
    premises.buildingNumber
      ? ar
        ? `مبنى ${premises.buildingNumber}`
        : `Building ${premises.buildingNumber}`
      : null,
    premises.street ? (ar ? `شارع ${premises.street}` : `${premises.street} St.`) : null,
    premises.area && premises.area !== premises.city ? premises.area : null,
    premises.city,
    ar ? `ولاية ${premises.wilayat}` : `Wilayat ${premises.wilayat}`,
    ar ? `محافظة ${premises.governorate}` : `${premises.governorate} Governorate`,
  ]
    .filter(Boolean)
    .join(ar ? '، ' : ', ');
  const count = (value: number) => (value > 0 ? String(value) : ar ? 'لا يوجد' : 'None');
  return (
    <>
      <p className="contract-doc__address">
        <span aria-hidden="true">⌖</span> {addressLine}
      </p>
      <dl className="contract-doc__table">
        <Row term={ar ? 'اسم العقار' : 'Property'}>{propertyName}</Row>
        <Row term={ar ? 'الرقم المرجعي' : 'Reference'}>
          <Ltr>{premises.serialNumber}</Ltr>
        </Row>
        <Row term={ar ? 'نوع العقار' : 'Type'}>{label(CATEGORIES, premises.category, ar)}</Row>
        <Row term={ar ? 'التأثيث' : 'Furnishing'}>{label(FURNISHING, premises.furnishing, ar)}</Row>
        <Row term={ar ? 'المحافظة' : 'Governorate'}>{premises.governorate}</Row>
        <Row term={ar ? 'الولاية' : 'Wilayat'}>{premises.wilayat}</Row>
        <Row term={ar ? 'المدينة / المنطقة' : 'City / area'}>
          {premises.area && premises.area !== premises.city
            ? `${premises.city} — ${premises.area}`
            : premises.city}
        </Row>
        <Row term={ar ? 'الشارع' : 'Street'}>{premises.street}</Row>
        <Row term={ar ? 'رقم المبنى' : 'Building no.'}>
          <Ltr>{premises.buildingNumber}</Ltr>
        </Row>
        <Row term={ar ? 'الرمز البريدي' : 'Postal code'}>
          <Ltr>{premises.postalCode}</Ltr>
        </Row>
        <Row term={ar ? 'رقم الصك' : 'Title deed no.'}>
          <Ltr>{premises.deedNumber}</Ltr>
        </Row>
        <Row term={ar ? 'رقم القطعة' : 'Plot no.'}>
          <Ltr>{premises.plotNumber}</Ltr>
        </Row>
        {premises.parkingSpaces ? (
          <Row term={ar ? 'مواقف السيارات' : 'Parking'}>{premises.parkingSpaces}</Row>
        ) : null}
        {premises.yearBuilt ? (
          <Row term={ar ? 'سنة البناء' : 'Year built'}>{premises.yearBuilt}</Row>
        ) : null}
      </dl>
      {unit ? (
        <div className="contract-doc__unit">
          <div className="contract-doc__unit-title">
            <span>{ar ? 'الوحدة' : 'Unit'}</span>
            <strong>
              <bdi dir="ltr">{unit.code}</bdi> — {ar ? unit.nameAr : unit.nameEn}
            </strong>
          </div>
          <ul className="contract-doc__unit-specs">
            <li>
              <span>{ar ? 'المساحة' : 'Area'}</span>
              <strong>
                {unit.areaSquareMeters ? `${unit.areaSquareMeters} ${ar ? 'م²' : 'm²'}` : '—'}
              </strong>
            </li>
            <li>
              <span>{ar ? 'الطابق' : 'Floor'}</span>
              <strong>{unit.floor ?? '—'}</strong>
            </li>
            <li>
              <span>{ar ? 'غرف النوم' : 'Bedrooms'}</span>
              <strong>{count(unit.bedrooms)}</strong>
            </li>
            <li>
              <span>{ar ? 'دورات المياه' : 'Bathrooms'}</span>
              <strong>{count(unit.bathrooms)}</strong>
            </li>
            <li>
              <span>{ar ? 'المجالس' : 'Majlis'}</span>
              <strong>{count(unit.majlis)}</strong>
            </li>
            <li>
              <span>{ar ? 'الصالات' : 'Halls'}</span>
              <strong>{count(unit.halls)}</strong>
            </li>
            <li>
              <span>{ar ? 'المطابخ' : 'Kitchens'}</span>
              <strong>{count(unit.kitchens)}</strong>
            </li>
            <li>
              <span>{ar ? 'مسبح' : 'Pool'}</span>
              <strong>{unit.hasPool ? (ar ? 'نعم' : 'Yes') : ar ? 'لا' : 'No'}</strong>
            </li>
          </ul>
        </div>
      ) : null}
    </>
  );
}
