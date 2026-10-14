import { Card, CardContent } from '@bhd-r/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BadgeChips } from '@/components/badges/badge-chips';
import { TermsDocument } from '@/components/terms-document';
import type { BadgeChip } from '@/lib/badges-shared';
import type { ContractDetail } from '@/lib/contract-detail-neon';
import type {
  ContractDocument,
  ContractFileKind,
  ContractPartyCard,
  ContractPremises,
} from '@/lib/contract-document';
import { formatMoney } from '@/lib/format';
import { omanLocations } from '@/lib/oman-locations';
import {
  ANNEX_META,
  type ContractAnnexDocument,
  type ContractAnnexKind,
} from '@/lib/contract-annex';
import { leaseContractTitle } from '@/lib/lease-booking-contract';
import type { PortalRole } from '@/lib/types';
import { stayTypeLabel } from '@/lib/ui-labels';
import { ContractActions } from './contract-actions';
import { ContractAnnexArticle } from './contract-annex-view';
import {
  BRAND_LOGO,
  DocLetterhead,
  contractKit,
  contractSerif,
  ltr,
  type Pair,
} from './contract-doc-parts';
import { ContractDocumentToolbar } from './contract-document-toolbar';
import { PropertyLocationMap } from './property-location-map';
import { SignatureForm } from './signature-form';

type Portal = Exclude<PortalRole, 'platform'>;

const DOCUMENT_ID = 'contract-document';
const annexDocumentId = (kind: string) => `contract-annex-${kind}`;
const BOOKING_COPY_ID = 'contract-booking-copy';

/** The QR's own link, kept on the site's origin so it opens in the same session. */
function bookingDocumentHref(booking: NonNullable<ContractDocument['booking']>): string {
  try {
    const url = new URL(booking.url);
    return `${url.pathname}${url.search}`;
  } catch {
    return booking.url;
  }
}

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
  reservation_esign: [
    'توقيع إلكتروني بخط اليد مع إثبات الهوية',
    'Handwritten e-signature with identity check',
  ],
};

const FILE_LABELS: Record<ContractFileKind, Pair> = {
  signature: ['توقيع الضيف الإلكتروني', 'Guest e-signature'],
  'id-front': ['الهوية — الوجه الأمامي', 'ID — front'],
  'id-back': ['الهوية — الوجه الخلفي', 'ID — back'],
  selfie: ['صورة شخصية للتحقق', 'Verification selfie'],
};

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

const NONE: Pair = ['لا يوجد', 'None'];
const YES: Pair = ['نعم', 'Yes'];
const NO: Pair = ['لا', 'No'];

/** Arabic counted noun: one / two / 3–10 plural / 11+ singular accusative. */
function arCount(count: number, forms: [string, string, string, string]): string {
  if (count === 1) return forms[0];
  if (count === 2) return forms[1];
  return `${count} ${count <= 10 ? forms[2] : forms[3]}`;
}

function enCount(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function label(map: Record<string, Pair>, key: string | null | undefined): Pair | null {
  if (!key) return null;
  return map[key] ?? [key, key];
}

const PLACES_EN = new Map<string, string>(
  omanLocations.flatMap((governorate) => [
    [governorate.ar, governorate.en],
    ...governorate.states.map((state) => [state.ar, state.en] as const),
  ]),
);

/** Place name in English when it is a known governorate or wilayat; otherwise as written. */
function placeEn(name: string | null | undefined): string | null {
  if (!name) return null;
  return PLACES_EN.get(name.trim()) ?? name;
}

function docTitle(doc: ContractDocument, contract: ContractArticleHead): Pair {
  if (doc.reservation) {
    const title = leaseContractTitle(doc.reservation.mode);
    return [title.ar, title.en];
  }
  if (contract.kind === 'renewal') return ['ملحق تجديد عقد', 'Contract Renewal Addendum'];
  if (doc.type === 'stay') return ['عقد إقامة قصيرة', 'Short-Stay Agreement'];
  if (doc.type === 'sale') return ['عقد بيع عقار', 'Property Sale Agreement'];
  return ['عقد إيجار', 'Lease Agreement'];
}

type Kit = ReturnType<typeof contractKit>;

/** What the document reads from the contract record; a reservation agreement fills the same shape. */
export type ContractArticleHead = Pick<
  ContractDetail,
  | 'reference'
  | 'kind'
  | 'status'
  | 'startsOn'
  | 'endsOn'
  | 'documentUrl'
  | 'documentHash'
  | 'parties'
  | 'property'
  | 'unit'
>;

/** Where the document's links and images point: a portal, or the public signing page. */
export type ContractArticleLinks = {
  file: (kind: ContractFileKind) => string;
  contract: (contractId: string) => string;
  annex: (kind: ContractAnnexKind) => string;
};

function documentFacts(contract: ContractArticleHead, doc: ContractDocument, ar: boolean) {
  const formatDateTime = (iso: string, lang: 'ar' | 'en') =>
    new Date(iso).toLocaleString(lang === 'ar' ? 'ar-OM' : 'en-GB', {
      timeZone: 'Asia/Muscat',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  const formatDay = (value: string, lang: 'ar' | 'en') =>
    new Date(value.length === 10 ? `${value}T00:00:00Z` : value).toLocaleDateString(
      lang === 'ar' ? 'ar-OM' : 'en-GB',
      {
        timeZone: value.length === 10 ? 'UTC' : 'Asia/Muscat',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      },
    );
  const dateTime = (iso: string | null | undefined): Pair | null =>
    iso ? [formatDateTime(iso, 'ar'), formatDateTime(iso, 'en')] : null;
  const day = (value: string | null | undefined): Pair | null =>
    value ? [formatDay(value, 'ar'), formatDay(value, 'en')] : null;
  const money = (value: ContractDocument['amount']): Pair | null =>
    value
      ? [
          formatMoney(value.amountMinor, value.currency, 'ar'),
          formatMoney(value.amountMinor, value.currency, 'en'),
        ]
      : null;
  const pick = (value: Pair | null) => (value ? value[ar ? 0 : 1] : '—');

  const titlePair = docTitle(doc, contract);
  const premises = doc.premises;
  return {
    dateTime,
    day,
    money,
    pick,
    titlePair,
    title: ar ? titlePair[0] : titlePair[1],
    ownerName: doc.owner?.name ?? contract.parties.owner?.displayName ?? '—',
    tenantName: doc.tenant?.name ?? contract.parties.tenant?.displayName ?? '—',
    propertyName: (premises
      ? [premises.propertyNameAr, premises.propertyNameEn]
      : contract.property
        ? [contract.property.nameAr, contract.property.nameEn]
        : null) as Pair | null,
    unitName: premises?.unit
      ? `${premises.unit.code} · ${ar ? premises.unit.nameAr : premises.unit.nameEn}`
      : contract.unit
        ? `${contract.unit.code} · ${ar ? contract.unit.nameAr : contract.unit.nameEn}`
        : '—',
    status: label(STATUS_LABELS, contract.status) ?? ([contract.status, contract.status] as Pair),
  };
}

export function ContractDocumentView({
  contract,
  doc,
  annexDocuments = [],
  portal,
  locale,
  viewerName,
  badges,
}: {
  contract: ContractDetail;
  doc: ContractDocument;
  /** Recorded annexes, held on the page so they can be printed with the contract. */
  annexDocuments?: ContractAnnexDocument[];
  portal: Portal;
  locale: 'ar' | 'en';
  viewerName: string;
  badges?: { owner: BadgeChip[]; tenant: BadgeChip[]; property: BadgeChip[] };
}) {
  const ar = locale === 'ar';
  const bookingCopy = contract.bookingCopy ?? null;
  const {
    dateTime,
    day,
    money,
    pick,
    title,
    ownerName,
    tenantName,
    propertyName,
    unitName,
    status,
  } = documentFacts(contract, doc, ar);
  const tenant = doc.tenant;
  const recipientPath =
    doc.type === 'stay'
      ? doc.stay?.guestPageHref
        ? `/${locale}${doc.stay.guestPageHref}`
        : null
      : `/${locale}/tenant/contracts/${contract.id}`;
  const summary = ar
    ? `${ownerName} ← ${tenantName} · ${pick(propertyName)} (${unitName}) · من ${pick(day(contract.startsOn))} إلى ${pick(day(contract.endsOn))} · القيمة ${pick(money(doc.amount))}`
    : `${ownerName} → ${tenantName} · ${pick(propertyName)} (${unitName}) · ${pick(day(contract.startsOn))} – ${pick(day(contract.endsOn))} · ${pick(money(doc.amount))}`;
  const links: ContractArticleLinks = {
    file: (kind) => `/api/portal/contracts/${contract.id}/files/${kind}?portal=${portal}`,
    contract: (contractId) => `/${locale}/${portal}/contracts/${contractId}`,
    annex: (kind) => `/${locale}/${portal}/contracts/${contract.id}/annex/${kind}`,
  };

  return (
    <div className="form-shell contract-detail contract-detail--document">
      <header className="portal-topbar contract-detail__topbar">
        <div>
          <span className="ops-kicker">BHD R · CONTRACT</span>
          <h1>{contract.reference}</h1>
          <p>
            {title} · {pick(status)}
          </p>
          {badges && (badges.owner.length || badges.tenant.length || badges.property.length) ? (
            <ul className="contract-detail__badges">
              {(
                [
                  [ar ? 'المؤجر' : 'Landlord', ownerName, badges.owner],
                  [ar ? 'المستأجر' : 'Tenant', tenantName, badges.tenant],
                  [ar ? 'العقار' : 'Property', pick(propertyName), badges.property],
                ] as const
              )
                .filter(([, , chips]) => chips.length)
                .map(([label, name, chips]) => (
                  <li key={label} className="name-with-mark">
                    <span className="muted">{label}:</span> <bdi>{name}</bdi>
                    <BadgeChips badges={chips} locale={locale} />
                  </li>
                ))}
            </ul>
          ) : null}
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
        parts={
          doc.annexes.length || bookingCopy
            ? [
                { id: DOCUMENT_ID, label: ar ? 'العقد' : 'Contract', available: true },
                ...(bookingCopy
                  ? [
                      {
                        id: BOOKING_COPY_ID,
                        label: ar ? 'نسخة مستند الحجز' : 'Booking document copy',
                        available: true,
                      },
                    ]
                  : []),
                ...doc.annexes.map((annex) => ({
                  id: annexDocumentId(annex.kind),
                  label: pick(ANNEX_META[annex.kind].title),
                  available: annexDocuments.some((item) => item.kind === annex.kind),
                })),
              ]
            : null
        }
      />

      {doc.annexes.length || doc.booking ? (
        <nav className="contract-annex-bar" aria-label={ar ? 'محاضر العقد' : 'Contract records'}>
          {doc.booking ? (
            <Link className="contract-annex-bar__item" href={bookingDocumentHref(doc.booking)}>
              <span className="contract-annex-bar__no">RSV</span>
              <span className="contract-annex-bar__title">
                {ar ? 'مستند الحجز وشروطه' : 'Booking document & terms'}
              </span>
              <small dir="ltr">{doc.booking.referenceCode}</small>
            </Link>
          ) : null}
          {doc.annexes.map((annex) => {
            const meta = ANNEX_META[annex.kind];
            const content = (
              <>
                <span className="contract-annex-bar__no">A{meta.number}</span>
                <span className="contract-annex-bar__title">{pick(meta.title)}</span>
                <small>
                  {annex.recordedAt
                    ? pick(dateTime(annex.recordedAt))
                    : ar
                      ? 'لم يُسجَّل بعد'
                      : 'Not recorded yet'}
                </small>
              </>
            );
            return annex.recordedAt ? (
              <Link
                key={annex.kind}
                className="contract-annex-bar__item"
                href={links.annex(annex.kind)}
              >
                {content}
              </Link>
            ) : (
              <span
                key={annex.kind}
                className="contract-annex-bar__item contract-annex-bar__item--pending"
                aria-disabled="true"
              >
                {content}
              </span>
            );
          })}
        </nav>
      ) : null}

      {annexDocuments.length || bookingCopy ? (
        <div className="contract-annex-stash" hidden>
          {bookingCopy ? (
            <ContractArticle
              id={BOOKING_COPY_ID}
              contract={bookingCopy.head}
              doc={bookingCopy.doc}
              locale={locale}
              links={{
                file: () => bookingCopy.signaturePng ?? '',
                contract: (contractId) => `/${locale}/${portal}/contracts/${contractId}`,
                annex: () => `/${locale}/${portal}/contracts/${contract.id}`,
              }}
            />
          ) : null}
          {annexDocuments.map((annex) => (
            <ContractAnnexArticle
              key={annex.kind}
              annex={annex}
              portal={portal}
              lang={locale}
              id={annexDocumentId(annex.kind)}
            />
          ))}
        </div>
      ) : null}

      {portal !== 'tenant' && !doc.letterhead?.logoDataUrl ? (
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

      <ContractArticle
        id={DOCUMENT_ID}
        contract={contract}
        doc={doc}
        locale={locale}
        links={links}
      />

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

/**
 * The contract as its original bilingual document: letterhead, seal, QR, articles,
 * signatures and print footer. Every official agreement on the site renders through it.
 */
export function ContractArticle({
  id,
  contract,
  doc,
  locale,
  links,
}: {
  id: string;
  contract: ContractArticleHead;
  doc: ContractDocument;
  locale: 'ar' | 'en';
  links: ContractArticleLinks;
}) {
  const ar = locale === 'ar';
  const kit = contractKit(ar);
  const { bi, row, para, order } = kit;
  const { dateTime, day, money, titlePair, title, ownerName, tenantName, propertyName, status } =
    documentFacts(contract, doc, ar);
  const [titleAr, titleEn] = titlePair;
  const stay = doc.type === 'stay';
  const sale = doc.type === 'sale';
  const reservation = doc.reservation ?? null;
  const owner = doc.owner;
  const tenant = doc.tenant;
  const premises = doc.premises;
  const signatureImage = doc.files.some((file) => file.kind === 'signature')
    ? links.file('signature')
    : null;
  const attachments = doc.files.filter((file) => file.kind !== 'signature');

  const letterhead = doc.letterhead;
  const contactLine = [
    letterhead?.phone || owner?.phone || null,
    letterhead?.email || owner?.email || null,
    letterhead?.registrationNumber ? `CR ${letterhead.registrationNumber}` : null,
  ].filter((part): part is string => Boolean(part));
  const firstRole: Pair = sale ? ['البائع', 'Seller'] : ['المؤجر', 'Landlord'];
  const secondRole: Pair = stay
    ? ['الضيف المستأجر', 'Guest']
    : sale
      ? ['المشتري', 'Buyer']
      : ['المستأجر', 'Tenant'];
  const firstParty: Pair = ['الطرف الأول', 'First Party'];
  const secondParty: Pair = ['الطرف الثاني', 'Second Party'];

  const guests: Pair | null =
    doc.stay && (doc.stay.adults || doc.stay.children)
      ? [
          [
            doc.stay.adults
              ? arCount(doc.stay.adults, ['بالغ واحد', 'بالغان', 'بالغين', 'بالغاً'])
              : null,
            doc.stay.children
              ? arCount(doc.stay.children, ['طفل واحد', 'طفلان', 'أطفال', 'طفلاً'])
              : null,
          ]
            .filter(Boolean)
            .join(' و'),
          [
            doc.stay.adults ? enCount(doc.stay.adults, 'adult', 'adults') : null,
            doc.stay.children ? enCount(doc.stay.children, 'child', 'children') : null,
          ]
            .filter(Boolean)
            .join(', '),
        ]
      : null;

  type TimelineEvent = { at: string; text: Pair };
  const event = (at: string | null | undefined, arText: string, enText: string) =>
    at ? [{ at, text: [arText, enText] as const }] : [];
  const timeline: TimelineEvent[] = [
    ...event(doc.createdAt, 'تحرير العقد', 'Contract drawn up'),
    ...event(
      doc.approval?.at,
      `اعتمده ${doc.approval?.byName ?? 'المؤجر'}`,
      `Approved by ${doc.approval?.byName ?? 'the landlord'}`,
    ),
    ...event(doc.sentAt, 'أُرسل للتوقيع', 'Sent for signature'),
    ...event(doc.termsAcceptedAt, 'قبل الطرف الثاني الشروط', 'Second party accepted the terms'),
    ...event(reservation?.paidAt, 'دُفع مبلغ ضمان الحجز', 'Booking deposit paid'),
    ...doc.signatures.flatMap((signature) => {
      const who = signature.name ? ` (${signature.name})` : '';
      return event(
        signature.signedAt,
        `وقّع ${signature.role === 'owner' ? 'الطرف الأول' : 'الطرف الثاني'}${who}`,
        `${signature.role === 'owner' ? 'First' : 'Second'} party signed${who}`,
      );
    }),
    ...event(doc.stay?.checkIn?.at, 'تسلّم العين المؤجرة', 'Premises handed over'),
    ...event(doc.stay?.checkOut?.at, 'إعادة العين المؤجرة', 'Premises returned'),
    ...event(doc.completedAt, 'اكتمل العقد', 'Contract completed'),
  ].sort((left, right) => left.at.localeCompare(right.at));

  let index = 0;
  const heading = ([headAr, headEn]: Pair) => {
    index += 1;
    return (
      <h2 className="contract-doc__heading">
        {order(
          <span key="ar" lang="ar" dir="rtl">
            <span className="contract-doc__ordinal">{ORDINALS_AR[index - 1] ?? index}:</span>{' '}
            {headAr}
          </span>,
          <span key="en" lang="en" dir="ltr">
            <span className="contract-doc__ordinal">Article {index}.</span> {headEn}
          </span>,
        )}
      </h2>
    );
  };

  const templateAr = doc.template.ar;
  const templateEn = doc.template.en;
  const sealSerial =
    [...doc.signatures]
      .filter((signature) => signature.serial)
      .sort((left, right) => left.signedAt.localeCompare(right.signedAt))
      .at(-1)?.serial ?? null;
  return (
    <article
      id={id}
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
              <DocLetterhead letterhead={letterhead} fallbackName={ownerName} />
            </td>
          </tr>
        </thead>
        <tfoot aria-hidden="true">
          <tr>
            <td>
              <div className="contract-doc__foot-space" />
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
                    <span>{bi(['رقم العقد', 'Contract No.'])}</span>
                    <strong>
                      <bdi dir="ltr">{contract.reference}</bdi>
                    </strong>
                  </div>
                  <div>
                    <span>{bi(['تاريخ التحرير', 'Date'])}</span>
                    <strong>{bi(day(doc.createdAt))}</strong>
                  </div>
                  <div>
                    <span>{bi(['حالة العقد', 'Status'])}</span>
                    <strong>{bi(status)}</strong>
                  </div>
                </div>
                {sealSerial ? (
                  <span
                    className={`contract-doc__seal contract-doc__seal--${contract.status} contract-doc__seal--serial`}
                    role="img"
                    aria-label={
                      ar
                        ? `توقيع إلكتروني رقم ${sealSerial}`
                        : `Electronic signature No. ${sealSerial}`
                    }
                  >
                    <span>توقيع إلكتروني</span>
                    <b dir="ltr">{sealSerial}</b>
                    <small dir="ltr">E-SIGNATURE No.</small>
                  </span>
                ) : (
                  <span
                    className={`contract-doc__seal contract-doc__seal--${contract.status}`}
                    aria-hidden="true"
                  >
                    <span>{status[0]}</span>
                    <small>{status[1]}</small>
                  </span>
                )}
                {doc.verification ? (
                  <a
                    className="contract-doc__qr"
                    href={doc.verification.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={ar ? 'رمز التحقق من العقد' : 'Contract verification code'}
                  >
                    <span dangerouslySetInnerHTML={{ __html: doc.verification.qrSvg }} />
                    <small>
                      <span lang="ar">امسح للتحقق</span>
                      <span lang="en">Scan to verify</span>
                    </small>
                  </a>
                ) : null}
              </div>

              {para(
                `إنه في يوم ${day(doc.createdAt)?.[0] ?? ''}، حُرّر هذا العقد واتُّفق بين كلٍّ من:`,
                `This agreement is made on ${day(doc.createdAt)?.[1] ?? ''} between:`,
                'contract-doc__preamble',
              )}

              <section className="contract-doc__section">
                {heading(['أطراف العقد', 'The Parties'])}
                <div className="contract-doc__parties">
                  {partyPlate(kit, {
                    order: firstParty,
                    role: firstRole,
                    party: owner,
                    fallbackName: ownerName,
                    representative:
                      doc.approval?.byName && doc.approval.byName !== ownerName
                        ? doc.approval.byName
                        : null,
                  })}
                  {partyPlate(kit, {
                    order: secondParty,
                    role: secondRole,
                    party: tenant,
                    fallbackName: tenantName,
                    representative: null,
                  })}
                </div>
                {para(
                  'وقد أقرّ الطرفان بأهليتهما للتعاقد، واتفقا على ما يلي:',
                  'Both parties, having full capacity to contract, agree as follows:',
                  'contract-doc__note-line',
                )}
              </section>

              <section className="contract-doc__section">
                {heading(
                  sale ? ['العقار المبيع', 'The Property'] : ['العين المؤجَّرة', 'The Premises'],
                )}
                {premisesBlock(kit, premises, propertyName)}
                {doc.location ? (
                  <PropertyLocationMap location={doc.location} locale={locale} bilingual />
                ) : null}
              </section>

              <section className="contract-doc__section">
                {heading(['المدة والقيمة', 'Term & Consideration'])}
                <dl className="contract-doc__table">
                  {reservation
                    ? null
                    : row(['تاريخ البدء', 'Commencement'], bi(day(contract.startsOn)))}
                  {reservation ? null : row(['تاريخ الانتهاء', 'Expiry'], bi(day(contract.endsOn)))}
                  {doc.stay?.nights ? row(['عدد الليالي', 'Nights'], doc.stay.nights) : null}
                  {guests ? row(['عدد الضيوف', 'Guests'], bi(guests)) : null}
                  {doc.stayType
                    ? row(
                        ['نوع الإقامة', 'Stay type'],
                        bi([stayTypeLabel(doc.stayType, 'ar'), stayTypeLabel(doc.stayType, 'en')]),
                      )
                    : null}
                  {row(
                    stay
                      ? ['قيمة الإقامة', 'Stay amount']
                      : sale
                        ? ['ثمن البيع', 'Price']
                        : reservation
                          ? ['الإيجار الشهري', 'Monthly rent']
                          : ['القيمة الإيجارية', 'Rent'],
                    bi(money(doc.amount)),
                  )}
                  {reservation ? (
                    <>
                      {row(
                        ['مبلغ ضمان الحجز المدفوع', 'Booking deposit paid'],
                        bi(money(reservation.depositPaid)),
                      )}
                      {row(
                        ['تاريخ دفع الضمان', 'Deposit paid on'],
                        bi(dateTime(reservation.paidAt)),
                      )}
                      {row(
                        ['الوحدة محجوزة حتى', 'Unit reserved until'],
                        bi(day(reservation.reservedUntil)),
                      )}
                    </>
                  ) : (
                    row(['مبلغ التأمين', 'Security deposit'], bi(money(doc.deposit) ?? NONE))
                  )}
                  {doc.source?.referenceCode
                    ? row(['مرجع الحجز', 'Booking reference'], ltr(doc.source.referenceCode))
                    : null}
                </dl>
              </section>

              {templateAr || templateEn ? (
                <section className="contract-doc__section">
                  {heading(['نص العقد', 'Contract Text'])}
                  <div
                    className={`contract-doc__para contract-doc__template${
                      templateAr && templateEn ? '' : ' contract-doc__para--single'
                    }`}
                  >
                    {order(
                      templateAr ? (
                        <div
                          key="ar"
                          lang="ar"
                          dir="rtl"
                          dangerouslySetInnerHTML={{ __html: templateAr }}
                        />
                      ) : null,
                      templateEn ? (
                        <div
                          key="en"
                          lang="en"
                          dir="ltr"
                          dangerouslySetInnerHTML={{ __html: templateEn }}
                        />
                      ) : null,
                    )}
                  </div>
                </section>
              ) : null}

              <section className="contract-doc__section">
                {heading(['الشروط والأحكام', 'Terms & Conditions'])}
                {doc.booking ? (
                  <div className="contract-doc__booking-basis">
                    <div>
                      {para(
                        `تُعدّ الشروط والأحكام التي وافق عليها الطرف الثاني${doc.booking.termsAcceptedAt ? ` بتاريخ ${dateTime(doc.booking.termsAcceptedAt)?.[0] ?? ''}` : ''} عند الحجز بموجب مستند الحجز رقم ${doc.booking.referenceCode} جزءاً لا يتجزأ من هذا العقد ومتمّمةً له، وتُقرأ معه وتُفسَّر معه، وهي أساس هذا العقد. وتُرفق بهذا العقد نسخة من مستند الحجز الموقّع لتكون مكمّلةً له.`,
                        `The terms and conditions the second party accepted${doc.booking.termsAcceptedAt ? ` on ${dateTime(doc.booking.termsAcceptedAt)?.[1] ?? ''}` : ''} when booking, under booking document No. ${doc.booking.referenceCode}, form an integral part of this agreement and complete it; they are read and construed together with it and are its basis. A copy of the signed booking document is attached to complete it.`,
                        'contract-doc__lead',
                      )}
                      <dl className="contract-doc__table">
                        {row(
                          ['رقم مستند الحجز', 'Booking document No.'],
                          <Link href={bookingDocumentHref(doc.booking)}>
                            {ltr(doc.booking.referenceCode)}
                          </Link>,
                        )}
                        {doc.booking.signedAt
                          ? row(
                              ['تاريخ توقيع مستند الحجز', 'Booking document signed'],
                              bi(dateTime(doc.booking.signedAt)),
                            )
                          : null}
                      </dl>
                    </div>
                    {doc.booking.qrSvg ? (
                      <a
                        className="contract-doc__qr contract-doc__qr--booking"
                        href={bookingDocumentHref(doc.booking)}
                        aria-label={ar ? 'رمز مستند الحجز' : 'Booking document code'}
                      >
                        <span dangerouslySetInnerHTML={{ __html: doc.booking.qrSvg }} />
                        <small>
                          <span lang="ar">مستند الحجز</span>
                          <span lang="en" dir="ltr">
                            {doc.booking.referenceCode}
                          </span>
                        </small>
                      </a>
                    ) : null}
                  </div>
                ) : null}
                {doc.terms.length ? (
                  <>
                    {doc.termsAcceptedAt
                      ? para(
                          `وافق الطرف الثاني على الشروط التالية بتاريخ ${dateTime(doc.termsAcceptedAt)?.[0] ?? ''}.`,
                          `The second party accepted the following terms on ${dateTime(doc.termsAcceptedAt)?.[1] ?? ''}.`,
                          'contract-doc__lead',
                        )
                      : null}
                    <TermsDocument blocks={doc.terms} />
                  </>
                ) : (
                  para(
                    'تسري الشروط الواردة في نص العقد أعلاه.',
                    'The terms in the contract text above apply.',
                    'contract-doc__lead',
                  )
                )}
              </section>

              <section className="contract-doc__section contract-doc__section--signatures">
                {heading(['التواقيع', 'Signatures'])}
                {para(
                  'وإثباتاً لما تقدّم، وقّع الطرفان على هذا العقد إلكترونياً، ولكلٍّ منهما نسخة مطابقة للأصل.',
                  'In witness whereof, the parties have signed this agreement electronically; each holds an identical copy.',
                  'contract-doc__lead',
                )}
                <div className="contract-doc__signatures">
                  {(['owner', 'tenant'] as const).map((side) => {
                    const signature = doc.signatures.find((entry) =>
                      side === 'owner' ? entry.role === 'owner' : entry.role !== 'owner',
                    );
                    const [partyAr, partyEn] = side === 'owner' ? firstParty : secondParty;
                    const [roleAr, roleEn] = side === 'owner' ? firstRole : secondRole;
                    return (
                      <div key={side} className="contract-doc__signature">
                        <span className="contract-doc__party-role">
                          {bi([`${partyAr} — ${roleAr}`, `${partyEn} — ${roleEn}`])}
                        </span>
                        <div className="contract-doc__signature-mark">
                          {signature && side === 'tenant' && signatureImage ? (
                            <img src={signatureImage} alt={ar ? 'التوقيع' : 'Signature'} />
                          ) : signature ? (
                            <span className="contract-doc__signature-seal">
                              {bi(['موقّع إلكترونياً', 'Signed electronically'])}
                            </span>
                          ) : null}
                        </div>
                        <dl className="contract-doc__signature-facts">
                          {row(
                            ['الاسم', 'Name'],
                            <bdi>
                              {signature?.name ?? (side === 'owner' ? ownerName : tenantName)}
                            </bdi>,
                          )}
                          {row(
                            ['التاريخ', 'Date'],
                            signature ? bi(dateTime(signature.signedAt)) : null,
                          )}
                          {signature
                            ? row(
                                ['الطريقة', 'Method'],
                                bi(label(SIGNATURE_METHODS, signature.method)),
                              )
                            : null}
                          {signature?.serial
                            ? row(
                                ['رقم التوقيع الإلكتروني', 'E-signature No.'],
                                <strong className="contract-doc__serial">
                                  {ltr(signature.serial)}
                                </strong>,
                              )
                            : null}
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
                {reservation
                  ? para(
                      'يوقّع الطرف الأول العقد النهائي عند إعداده، ويكون هذا الاتفاق جزءاً منه.',
                      'The first party signs the final contract when it is prepared; this agreement forms part of it.',
                      'contract-doc__lead',
                    )
                  : null}
              </section>

              <section className="contract-doc__section">
                {heading(['المرفقات والوثائق', 'Annexes & Documents'])}
                {doc.booking
                  ? para(
                      `يُرفق بهذا العقد ويُعدّ مكمّلاً له: نسخة من مستند الحجز رقم ${doc.booking.referenceCode} الموقّع إلكترونياً، بما فيه الشروط والأحكام التي وافق عليها الطرف الثاني.`,
                      `Attached to and completing this agreement: a copy of the e-signed booking document No. ${doc.booking.referenceCode}, including the terms the second party accepted.`,
                      'contract-doc__lead',
                    )
                  : null}
                {attachments.length || contract.documentUrl ? (
                  <ul className="contract-doc__files">
                    {attachments.map((file) => (
                      <li key={file.kind}>
                        <a href={links.file(file.kind)} target="_blank" rel="noreferrer">
                          <img
                            src={links.file(file.kind)}
                            alt={FILE_LABELS[file.kind][ar ? 0 : 1]}
                            loading="lazy"
                          />
                          <span>{bi(FILE_LABELS[file.kind])}</span>
                        </a>
                        {file.signedAt ? (
                          <small className="muted">{bi(dateTime(file.signedAt))}</small>
                        ) : null}
                      </li>
                    ))}
                    {contract.documentUrl ? (
                      <li className="contract-doc__file-pdf">
                        <a href={contract.documentUrl} target="_blank" rel="noopener noreferrer">
                          <span className="contract-doc__pdf-icon">PDF</span>
                          <span>{bi(['النسخة المختومة من العقد', 'Sealed contract copy'])}</span>
                        </a>
                      </li>
                    ) : null}
                  </ul>
                ) : doc.files.length ? (
                  para(
                    'وثائق الهوية متاحة لمن يملك صلاحية إدارة الحجوزات فقط.',
                    'ID documents are visible only to booking managers.',
                    'contract-doc__lead',
                  )
                ) : doc.booking ? null : (
                  para('لا توجد مرفقات.', 'No annexes.', 'contract-doc__lead')
                )}
              </section>

              {reservation ? null : (
                <section className="contract-doc__section">
                  {heading(['الملاحق', 'Addenda'])}
                  {doc.parent ? (
                    <p className="contract-doc__parent">
                      {bi(['هذا ملحق للعقد الأصلي', 'This is an addendum to'])}{' '}
                      <Link href={links.contract(doc.parent.id)}>
                        <bdi dir="ltr">{doc.parent.reference}</bdi>
                      </Link>
                    </p>
                  ) : null}
                  {doc.annexes.length ? (
                    <>
                      {para(
                        'تُعدّ الملاحق التالية جزءاً لا يتجزأ من هذا العقد ومتمّمة له، ولكلٍّ منها مستند مستقل يُطبع ويوقَّع على حدة.',
                        'The following annexes form an integral part of this agreement and complete it; each is a separate document, printed and signed on its own.',
                        'contract-doc__lead',
                      )}
                      <ol className="contract-doc__annexes">
                        {doc.annexes.map((annex) => {
                          const meta = ANNEX_META[annex.kind];
                          const title = bi(meta.title);
                          return (
                            <li key={annex.kind}>
                              <span className="contract-doc__annex-no">{meta.number}</span>
                              <span className="contract-doc__annex-title">
                                {annex.recordedAt ? (
                                  <Link href={links.annex(annex.kind)}>{title}</Link>
                                ) : (
                                  title
                                )}
                                <bdi dir="ltr">{annex.reference}</bdi>
                              </span>
                              <span className="contract-doc__annex-state">
                                {annex.recordedAt
                                  ? bi(dateTime(annex.recordedAt))
                                  : bi(['لم يُسجَّل بعد', 'Not recorded yet'])}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    </>
                  ) : null}
                  {doc.addenda.length ? (
                    <ul className="contract-doc__addenda">
                      {doc.addenda.map((addendum) => (
                        <li key={addendum.id}>
                          <Link href={links.contract(addendum.id)}>
                            <bdi dir="ltr">{addendum.reference}</bdi>
                          </Link>
                          <span>
                            {bi(
                              addendum.kind === 'renewal'
                                ? ['تجديد', 'Renewal']
                                : [addendum.kind, addendum.kind],
                            )}
                          </span>
                          <span>{bi(label(STATUS_LABELS, addendum.status))}</span>
                          <span>{bi(day(addendum.createdAt))}</span>
                        </li>
                      ))}
                    </ul>
                  ) : doc.parent || doc.annexes.length ? null : (
                    para('لا توجد ملاحق لهذا العقد.', 'No addenda.', 'contract-doc__lead')
                  )}
                </section>
              )}

              <section className="contract-doc__section">
                {heading(['سجل العقد', 'Contract Record'])}
                <ol className="contract-doc__timeline">
                  {timeline.map((event, position) => (
                    <li key={`${event.at}-${position}`}>
                      <time dateTime={event.at}>{bi(dateTime(event.at))}</time>
                      <span>{bi(event.text)}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <div
                className={`contract-doc__integrity${doc.verification ? ' contract-doc__integrity--qr' : ''}`}
              >
                {doc.verification ? (
                  <span
                    className="contract-doc__integrity-qr"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: doc.verification.qrSvg }}
                  />
                ) : null}
                <div>
                  {para(
                    'صدرت هذه الوثيقة إلكترونياً عبر منصة BHD R، والتواقيع أعلاه موثّقة ببصمات رقمية لا تقبل التعديل.',
                    'Issued electronically via BHD R; the signatures above are sealed with tamper-evident digital fingerprints.',
                  )}
                  {sealSerial ? (
                    <div className="contract-doc__para">
                      {order(
                        <p key="ar" lang="ar" dir="rtl">
                          تم توثيق هذا العقد بتوقيع إلكتروني رقم{' '}
                          <bdi dir="ltr" className="contract-doc__nowrap">
                            {sealSerial}
                          </bdi>
                        </p>,
                        <p key="en" lang="en" dir="ltr">
                          This contract was authenticated by electronic signature No.{' '}
                          <span className="contract-doc__nowrap">{sealSerial}</span>
                        </p>,
                      )}
                    </div>
                  ) : null}
                  {doc.verification
                    ? para(
                        'للتحقق من صحة العقد واعتماده امسح الرمز أو افتح الرابط:',
                        'To verify this contract, scan the code or open:',
                      )
                    : null}
                  {doc.verification ? <code dir="ltr">{doc.verification.url}</code> : null}
                  {contract.documentHash ? (
                    <code dir="ltr">SHA-256 {contract.documentHash}</code>
                  ) : null}
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <footer className="contract-doc__pagefoot">
        <span>
          {titleAr} · {titleEn} · <bdi dir="ltr">{contract.reference}</bdi>
        </span>
        <span dir="ltr">
          {contactLine.length ? contactLine.join(' · ') : 'Issued electronically via BHD R'}
        </span>
      </footer>
    </article>
  );
}

function partyPlate(
  { bi, row }: Kit,
  {
    order,
    role,
    party,
    fallbackName,
    representative,
  }: {
    order: Pair;
    role: Pair;
    party: ContractPartyCard | null;
    fallbackName: string;
    representative: string | null;
  },
) {
  const company = party?.entityType === 'company';
  return (
    <div className="contract-doc__party">
      <div className="contract-doc__party-band">
        <strong>{bi(order)}</strong>
        <span>{bi(role)}</span>
      </div>
      <dl className="contract-doc__party-facts">
        {row(
          company ? ['اسم الشركة', 'Company'] : ['الاسم', 'Name'],
          <bdi>{party?.name ?? fallbackName}</bdi>,
        )}
        {row(
          ['الصفة', 'Capacity'],
          bi(company ? ['شخص اعتباري', 'Legal entity'] : ['شخص طبيعي', 'Individual']),
        )}
        {company ? (
          <>
            {row(['السجل التجاري', 'CR number'], ltr(party?.crNumber))}
            {row(
              ['المفوّض بالتوقيع', 'Authorised signatory'],
              party?.signatoryName ? <bdi>{party.signatoryName}</bdi> : null,
            )}
            {row(['رقمه المدني', 'Signatory civil ID'], ltr(party?.signatoryCivilId))}
          </>
        ) : (
          <>
            {row(['الرقم المدني', 'Civil ID'], ltr(party?.civilId))}
            {party?.passport ? row(['رقم الجواز', 'Passport'], ltr(party.passport)) : null}
            {party?.nationality ? row(['الجنسية', 'Nationality'], party.nationality) : null}
          </>
        )}
        {row(['الهاتف', 'Phone'], ltr(party?.phone))}
        {row(['البريد الإلكتروني', 'Email'], ltr(party?.email))}
        {representative
          ? row(['يمثّله في الاعتماد', 'Represented by'], <bdi>{representative}</bdi>)
          : null}
      </dl>
    </div>
  );
}

function premisesBlock(
  { bi, row, order }: Kit,
  premises: ContractPremises | null,
  propertyName: Pair | null,
) {
  if (!premises) {
    return <dl className="contract-doc__table">{row(['العقار', 'Property'], bi(propertyName))}</dl>;
  }
  const unit = premises.unit;
  const area = premises.area && premises.area !== premises.city ? premises.area : null;
  const addressAr = [
    premises.buildingNumber ? `مبنى ${premises.buildingNumber}` : null,
    premises.street ? `شارع ${premises.street}` : null,
    area,
    premises.city,
    `ولاية ${premises.wilayat}`,
    `محافظة ${premises.governorate}`,
    'سلطنة عُمان',
  ]
    .filter(Boolean)
    .join('، ');
  const addressEn = [
    premises.buildingNumber ? `Building ${premises.buildingNumber}` : null,
    premises.street ? `Street ${placeEn(premises.street)}` : null,
    placeEn(area),
    placeEn(premises.city),
    `Wilayat of ${placeEn(premises.wilayat)}`,
    `${placeEn(premises.governorate)} Governorate`,
    'Sultanate of Oman',
  ].filter((part): part is string => Boolean(part));
  const count = (value: number) => (value > 0 ? String(value) : bi(NONE));
  const place = (value: string | null | undefined) =>
    value ? bi([value, placeEn(value) ?? value]) : null;
  const specs: Array<{ term: Pair; value: ReactNode }> = unit
    ? [
        {
          term: ['المساحة', 'Area'],
          value: unit.areaSquareMeters ? ltr(`${unit.areaSquareMeters} m²`) : '—',
        },
        { term: ['الطابق', 'Floor'], value: unit.floor ?? '—' },
        { term: ['غرف النوم', 'Bedrooms'], value: count(unit.bedrooms) },
        { term: ['دورات المياه', 'Bathrooms'], value: count(unit.bathrooms) },
        { term: ['المجالس', 'Majlis'], value: count(unit.majlis) },
        { term: ['الصالات', 'Halls'], value: count(unit.halls) },
        { term: ['المطابخ', 'Kitchens'], value: count(unit.kitchens) },
        { term: ['مسبح', 'Pool'], value: bi(unit.hasPool ? YES : NO) },
      ]
    : [];
  return (
    <>
      <div className="contract-doc__address">
        {order(
          <p key="ar" lang="ar" dir="rtl">
            {addressAr}
          </p>,
          <p key="en" lang="en" dir="ltr">
            {addressEn.map((part, position) => (
              <span key={part}>
                {position ? ', ' : null}
                <bdi>{part}</bdi>
              </span>
            ))}
          </p>,
        )}
      </div>
      <dl className="contract-doc__table">
        {row(['اسم العقار', 'Property'], bi(propertyName))}
        {row(['الرقم المرجعي', 'Reference'], ltr(premises.serialNumber))}
        {row(['نوع العقار', 'Type'], bi(label(CATEGORIES, premises.category)))}
        {row(['التأثيث', 'Furnishing'], bi(label(FURNISHING, premises.furnishing)))}
        {row(['المحافظة', 'Governorate'], place(premises.governorate))}
        {row(['الولاية', 'Wilayat'], place(premises.wilayat))}
        {row(['المدينة', 'City'], place(premises.city))}
        {area ? row(['المنطقة', 'Area'], place(area)) : null}
        {row(['الشارع', 'Street'], premises.street)}
        {row(['رقم المبنى', 'Building no.'], ltr(premises.buildingNumber))}
        {row(['الرمز البريدي', 'Postal code'], ltr(premises.postalCode))}
        {row(['رقم الصك', 'Title deed no.'], ltr(premises.deedNumber))}
        {row(['رقم القطعة', 'Plot no.'], ltr(premises.plotNumber))}
        {premises.parkingSpaces ? row(['مواقف السيارات', 'Parking'], premises.parkingSpaces) : null}
        {premises.yearBuilt ? row(['سنة البناء', 'Year built'], premises.yearBuilt) : null}
      </dl>
      {unit ? (
        <div className="contract-doc__unit">
          <div className="contract-doc__unit-title">
            <span>{bi(['الوحدة', 'Unit'])}</span>
            <strong>
              {unit.nameAr.includes(unit.code) && unit.nameEn.includes(unit.code) ? null : (
                <>
                  <bdi dir="ltr">{unit.code}</bdi> —{' '}
                </>
              )}
              {bi([unit.nameAr, unit.nameEn])}
            </strong>
          </div>
          <ul className="contract-doc__unit-specs">
            {specs.map((spec) => (
              <li key={spec.term[1]}>
                <span>{bi(spec.term)}</span>
                <strong>{spec.value}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
