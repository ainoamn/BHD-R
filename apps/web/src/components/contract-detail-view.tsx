import { Card, CardContent, StatusBadge } from '@bhd-r/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  TermsDocument,
  TermsLetterheadFooter,
  TermsLetterheadHeader,
} from '@/components/terms-document';
import { loadContractDetailFromNeon, type ContractDetail } from '@/lib/contract-detail-neon';
import type { ContractDocument, ContractFileKind } from '@/lib/contract-document';
import { formatMoney } from '@/lib/format';
import { ApiError, apiFetch } from '@/lib/server-api';
import { requirePortal } from '@/lib/viewer';
import type { PortalRole } from '@/lib/types';
import { ContractActions } from './contract-actions';
import { ContractDocumentToolbar } from './contract-document-toolbar';
import { SignatureForm } from './signature-form';

type Portal = Exclude<PortalRole, 'platform'>;
type Viewer = Awaited<ReturnType<typeof requirePortal>>;

const DOCUMENT_ID = 'contract-document';

export async function ContractDetailView({
  portal,
  locale,
  contractId,
}: {
  portal: Portal;
  locale: string;
  contractId: string;
}) {
  const currentLocale = locale === 'en' ? 'en' : 'ar';
  const ar = currentLocale === 'ar';
  const viewer = await requirePortal(currentLocale, portal);
  let contract = await loadContractDetailFromNeon(contractId, portal).catch((error: unknown) => {
    console.error('contract detail (neon) failed', error);
    return null;
  });
  if (!contract) {
    contract = await apiFetch<ContractDetail>(
      portal === 'tenant'
        ? `/v1/tenant/contracts/${encodeURIComponent(contractId)}`
        : `/v1/leasing/contracts/${encodeURIComponent(contractId)}`,
    ).catch((error: unknown) => {
      if (error instanceof ApiError && [400, 403, 404].includes(error.status)) notFound();
      return null;
    });
  }
  if (!contract) {
    return (
      <div className="form-shell contract-detail">
        <Card>
          <CardContent>
            <h1>{ar ? 'تعذّر فتح العقد الآن' : 'The contract could not be opened'}</h1>
            <p className="muted">
              {ar
                ? 'الخدمة مشغولة لحظياً. أعد المحاولة بعد ثوانٍ.'
                : 'The service is busy for a moment. Try again in a few seconds.'}
            </p>
            <Link
              className="button button--secondary"
              href={`/${currentLocale}/${portal}/contracts`}
            >
              {ar ? 'العودة إلى العقود' : 'Back to contracts'}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (contract.document) {
    return (
      <ContractDocumentView
        contract={contract}
        doc={contract.document}
        portal={portal}
        locale={currentLocale}
        viewer={viewer}
      />
    );
  }
  return (
    <SimpleContractView
      contract={contract}
      portal={portal}
      locale={currentLocale}
      viewer={viewer}
    />
  );
}

const STATUS_LABELS: Record<string, [string, string]> = {
  draft: ['مسودة', 'Draft'],
  sent: ['مُرسل للتوقيع', 'Sent for signature'],
  partially_signed: ['موقّع جزئياً', 'Partially signed'],
  signed: ['موقّع ونافذ', 'Signed & in force'],
  void: ['ملغى', 'Void'],
  terminated: ['منتهٍ', 'Terminated'],
};

const SIGNATURE_METHODS: Record<string, [string, string]> = {
  system_on_approval: ['توقيع عند الاعتماد في المنصة', 'Signed on approval in the platform'],
  booking_terms_acceptance: [
    'قبول الشروط عند الحجز مع توقيع إلكتروني',
    'Terms accepted at booking with e-signature',
  ],
  booking_confirmation: ['تأكيد الحجز', 'Booking confirmation'],
};

const FILE_LABELS: Record<ContractFileKind, [string, string]> = {
  signature: ['توقيع الضيف الإلكتروني', 'Guest e-signature'],
  'id-front': ['الهوية — الوجه الأمامي', 'ID — front'],
  'id-back': ['الهوية — الوجه الخلفي', 'ID — back'],
  selfie: ['صورة شخصية للتحقق', 'Verification selfie'],
};

const STAY_TYPES: Record<string, [string, string]> = {
  day_use: ['استخدام نهاري', 'Day use'],
  overnight_only: ['مبيت فقط', 'Overnight only'],
  full_day: ['يوم كامل', 'Full day'],
};

function label(map: Record<string, [string, string]>, key: string, ar: boolean): string {
  const found = map[key];
  return found ? found[ar ? 0 : 1] : key;
}

function docTitle(doc: ContractDocument, contract: ContractDetail, ar: boolean) {
  if (contract.kind === 'renewal') return ar ? 'ملحق تجديد عقد' : 'Contract renewal addendum';
  if (doc.type === 'stay') return ar ? 'عقد إقامة قصيرة' : 'Short-stay agreement';
  if (doc.type === 'sale') return ar ? 'عقد بيع' : 'Sale agreement';
  return ar ? 'عقد إيجار' : 'Lease agreement';
}

function Section({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="contract-doc__section">
      <h2 className="contract-doc__heading">
        <span className="contract-doc__index">{index}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="contract-doc__fact">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ContractDocumentView({
  contract,
  doc,
  portal,
  locale,
  viewer,
}: {
  contract: ContractDetail;
  doc: ContractDocument;
  portal: Portal;
  locale: 'ar' | 'en';
  viewer: Viewer;
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
    value ? formatMoney(value.amountMinor, value.currency, locale) : '—';

  const title = docTitle(doc, contract, ar);
  const stay = doc.type === 'stay';
  const ownerName = contract.parties.owner?.displayName ?? '—';
  const tenantName = contract.parties.tenant?.displayName ?? '—';
  const propertyName = contract.property
    ? ar
      ? contract.property.nameAr
      : contract.property.nameEn
    : '—';
  const unitName = contract.unit
    ? `${contract.unit.code} · ${ar ? contract.unit.nameAr : contract.unit.nameEn}`
    : '—';
  const status = label(STATUS_LABELS, contract.status, ar);
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
    ? `${ownerName} ← ${tenantName} · ${propertyName} (${unitName}) · من ${day(contract.startsOn)} إلى ${day(contract.endsOn)} · القيمة ${money(doc.amount)}`
    : `${ownerName} → ${tenantName} · ${propertyName} (${unitName}) · ${day(contract.startsOn)} – ${day(contract.endsOn)} · ${money(doc.amount)}`;
  const timeline = [
    { at: doc.createdAt, text: ar ? 'أُنشئ العقد' : 'Contract created' },
    ...(doc.approval?.at
      ? [
          {
            at: doc.approval.at,
            text: ar
              ? `اعتمده ${doc.approval.byName ?? 'المالك'}`
              : `Approved by ${doc.approval.byName ?? 'the owner'}`,
          },
        ]
      : []),
    ...(doc.sentAt ? [{ at: doc.sentAt, text: ar ? 'أُرسل للتوقيع' : 'Sent for signature' }] : []),
    ...(doc.termsAcceptedAt
      ? [{ at: doc.termsAcceptedAt, text: ar ? 'قبل الضيف الشروط' : 'Guest accepted the terms' }]
      : []),
    ...doc.signatures.map((signature) => ({
      at: signature.signedAt,
      text: ar
        ? `وقّع ${signature.role === 'owner' ? 'المالك' : 'المستأجر'}${signature.name ? ` (${signature.name})` : ''}`
        : `${signature.role === 'owner' ? 'Owner' : 'Tenant'} signed${signature.name ? ` (${signature.name})` : ''}`,
    })),
    ...(doc.stay?.checkIn
      ? [{ at: doc.stay.checkIn.at, text: ar ? 'تسجيل الوصول' : 'Checked in' }]
      : []),
    ...(doc.stay?.checkOut
      ? [{ at: doc.stay.checkOut.at, text: ar ? 'تسجيل المغادرة' : 'Checked out' }]
      : []),
    ...(doc.completedAt
      ? [{ at: doc.completedAt, text: ar ? 'اكتمل العقد' : 'Contract completed' }]
      : []),
  ].sort((left, right) => left.at.localeCompare(right.at));

  let section = 0;
  const next = () => (section += 1);

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
                email: doc.tenantContact?.email ?? null,
                phone: doc.tenantContact?.phone ?? null,
              }
        }
        recipientPath={portal === 'tenant' ? null : recipientPath}
        pdfUrl={contract.documentUrl}
      />

      <article id={DOCUMENT_ID} className="contract-doc" dir={ar ? 'rtl' : 'ltr'} lang={locale}>
        {doc.letterhead ? (
          <TermsLetterheadHeader letterhead={doc.letterhead} />
        ) : (
          <div className="contract-doc__brand">BHD R</div>
        )}

        <div className="contract-doc__title">
          <div>
            <h1>{title}</h1>
            <p className="contract-doc__subtitle">
              {ar ? 'رقم العقد' : 'Contract no.'} <bdi dir="ltr">{contract.reference}</bdi> ·{' '}
              {ar ? 'تاريخ الإصدار' : 'Issued'} {day(doc.createdAt)}
            </p>
          </div>
          <span className={`contract-doc__stamp contract-doc__stamp--${contract.status}`}>
            {status}
          </span>
        </div>

        <Section index={next()} title={ar ? 'أطراف العقد' : 'Parties'}>
          <div className="contract-doc__parties">
            <div className="contract-doc__party">
              <span className="contract-doc__party-role">
                {ar ? 'الطرف الأول — المالك / المؤجر' : 'First party — owner / landlord'}
              </span>
              <strong>{ownerName}</strong>
              {doc.approval?.byName && doc.approval.byName !== ownerName ? (
                <span className="muted">
                  {ar ? 'يمثله: ' : 'Represented by: '}
                  {doc.approval.byName}
                </span>
              ) : null}
            </div>
            <div className="contract-doc__party">
              <span className="contract-doc__party-role">
                {stay
                  ? ar
                    ? 'الطرف الثاني — الضيف'
                    : 'Second party — guest'
                  : doc.type === 'sale'
                    ? ar
                      ? 'الطرف الثاني — المشتري'
                      : 'Second party — buyer'
                    : ar
                      ? 'الطرف الثاني — المستأجر'
                      : 'Second party — tenant'}
              </span>
              <strong>{tenantName}</strong>
              {doc.tenantContact?.email ? (
                <bdi dir="ltr" className="muted">
                  {doc.tenantContact.email}
                </bdi>
              ) : null}
              {doc.tenantContact?.phone ? (
                <bdi dir="ltr" className="muted">
                  {doc.tenantContact.phone}
                </bdi>
              ) : null}
            </div>
          </div>
        </Section>

        <Section index={next()} title={ar ? 'محل العقد' : 'Subject of the contract'}>
          <dl className="contract-doc__facts">
            <Fact term={ar ? 'العقار' : 'Property'}>{propertyName}</Fact>
            <Fact term={ar ? 'الوحدة' : 'Unit'}>{unitName}</Fact>
            {doc.stayType ? (
              <Fact term={ar ? 'نوع الإقامة' : 'Stay type'}>
                {label(STAY_TYPES, doc.stayType, ar)}
              </Fact>
            ) : null}
          </dl>
        </Section>

        <Section index={next()} title={ar ? 'المدة والقيمة' : 'Term & value'}>
          <dl className="contract-doc__facts">
            <Fact term={ar ? 'تاريخ البدء' : 'Starts on'}>{day(contract.startsOn)}</Fact>
            <Fact term={ar ? 'تاريخ الانتهاء' : 'Ends on'}>{day(contract.endsOn)}</Fact>
            {doc.stay?.nights ? (
              <Fact term={ar ? 'عدد الليالي' : 'Nights'}>{doc.stay.nights}</Fact>
            ) : null}
            {doc.stay && (doc.stay.adults || doc.stay.children) ? (
              <Fact term={ar ? 'الضيوف' : 'Guests'}>
                {ar
                  ? `${doc.stay.adults ?? 0} بالغ${doc.stay.children ? ` و${doc.stay.children} طفل` : ''}`
                  : `${doc.stay.adults ?? 0} adult(s)${doc.stay.children ? `, ${doc.stay.children} child(ren)` : ''}`}
              </Fact>
            ) : null}
            <Fact term={stay ? (ar ? 'قيمة الإقامة' : 'Stay amount') : ar ? 'القيمة' : 'Amount'}>
              {money(doc.amount)}
            </Fact>
            <Fact term={ar ? 'التأمين' : 'Deposit'}>{money(doc.deposit)}</Fact>
            {doc.source?.referenceCode ? (
              <Fact term={ar ? 'مرجع الحجز' : 'Booking reference'}>
                {doc.stay?.guestPageHref && portal !== 'tenant' ? (
                  <a href={`/${locale}${doc.stay.guestPageHref}`} target="_blank" rel="noreferrer">
                    <bdi dir="ltr">{doc.source.referenceCode}</bdi>
                  </a>
                ) : (
                  <bdi dir="ltr">{doc.source.referenceCode}</bdi>
                )}
              </Fact>
            ) : null}
          </dl>
        </Section>

        {doc.stay ? (
          <Section index={next()} title={ar ? 'الاستلام والتسليم' : 'Check-in & check-out'}>
            <dl className="contract-doc__facts">
              <Fact term={ar ? 'وقت الوصول والاستلام' : 'Checked in'}>
                {doc.stay.checkIn
                  ? dateTime(doc.stay.checkIn.at)
                  : ar
                    ? 'لم يُسجَّل بعد'
                    : 'Not yet'}
                {doc.stay.checkIn?.notes ? (
                  <span className="contract-doc__note">{doc.stay.checkIn.notes}</span>
                ) : null}
              </Fact>
              <Fact term={ar ? 'وقت المغادرة والتسليم' : 'Checked out'}>
                {doc.stay.checkOut
                  ? dateTime(doc.stay.checkOut.at)
                  : ar
                    ? 'لم يُسجَّل بعد'
                    : 'Not yet'}
                {doc.stay.checkOut?.notes ? (
                  <span className="contract-doc__note">{doc.stay.checkOut.notes}</span>
                ) : null}
              </Fact>
            </dl>
          </Section>
        ) : null}

        {doc.templateHtml ? (
          <Section index={next()} title={ar ? 'نص العقد' : 'Contract text'}>
            <div
              className="contract-doc__template"
              dangerouslySetInnerHTML={{ __html: doc.templateHtml }}
            />
          </Section>
        ) : null}

        <Section index={next()} title={ar ? 'الشروط والأحكام' : 'Terms & conditions'}>
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
        </Section>

        <Section index={next()} title={ar ? 'التواقيع' : 'Signatures'}>
          {doc.signatures.length ? (
            <div className="contract-doc__signatures">
              {doc.signatures.map((signature) => (
                <div key={signature.id} className="contract-doc__signature">
                  <span className="contract-doc__party-role">
                    {signature.role === 'owner'
                      ? ar
                        ? 'عن الطرف الأول'
                        : 'For the first party'
                      : ar
                        ? 'الطرف الثاني'
                        : 'Second party'}
                  </span>
                  <div className="contract-doc__signature-mark">
                    {signature.role !== 'owner' && signatureImage ? (
                      <img src={signatureImage} alt={ar ? 'التوقيع' : 'Signature'} />
                    ) : (
                      <span className="contract-doc__signature-seal">
                        {ar ? 'موقّع إلكترونياً' : 'Signed electronically'}
                      </span>
                    )}
                  </div>
                  <strong>
                    {signature.name ?? (signature.role === 'owner' ? ownerName : tenantName)}
                  </strong>
                  {signature.email ? (
                    <bdi dir="ltr" className="muted">
                      {signature.email}
                    </bdi>
                  ) : null}
                  <span>{label(SIGNATURE_METHODS, signature.method, ar)}</span>
                  <span>{dateTime(signature.signedAt)}</span>
                  <code className="contract-doc__hash" dir="ltr">
                    {signature.hash}
                  </code>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">
              {ar ? 'لم يُسجَّل أي توقيع بعد.' : 'No signature recorded yet.'}
            </p>
          )}
        </Section>

        <Section index={next()} title={ar ? 'المرفقات والوثائق' : 'Attachments & documents'}>
          {attachments.length || contract.documentUrl ? (
            <ul className="contract-doc__files">
              {attachments.map((file) => (
                <li key={file.kind}>
                  <a href={fileUrl(file.kind)} target="_blank" rel="noreferrer">
                    <img
                      src={fileUrl(file.kind)}
                      alt={label(FILE_LABELS, file.kind, ar)}
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
                  : 'No attachments.'}
            </p>
          )}
        </Section>

        <Section index={next()} title={ar ? 'الملاحق' : 'Addenda'}>
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
                    {addendum.kind === 'renewal' ? (ar ? 'تجديد' : 'Renewal') : addendum.kind}
                  </span>
                  <span>{label(STATUS_LABELS, addendum.status, ar)}</span>
                  <span>{day(addendum.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : doc.parent ? null : (
            <p className="muted">{ar ? 'لا توجد ملاحق لهذا العقد.' : 'No addenda.'}</p>
          )}
        </Section>

        <Section index={next()} title={ar ? 'سجل العقد' : 'Contract record'}>
          <ol className="contract-doc__timeline">
            {timeline.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <time dateTime={event.at}>{dateTime(event.at)}</time>
                <span>{event.text}</span>
              </li>
            ))}
          </ol>
        </Section>

        <div className="contract-doc__integrity">
          <span>
            {ar
              ? 'صدرت هذه الوثيقة إلكترونياً من منصة BHD R، والتواقيع أعلاه موثقة ببصمات رقمية.'
              : 'Issued electronically by BHD R; the signatures above are sealed with digital fingerprints.'}
          </span>
          {contract.documentHash ? <code dir="ltr">SHA-256 {contract.documentHash}</code> : null}
        </div>

        {doc.letterhead ? <TermsLetterheadFooter letterhead={doc.letterhead} /> : null}
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
        <SignatureForm contractId={contract.id} expectedName={viewer.displayName} />
      ) : null}
    </div>
  );
}

function SimpleContractView({
  contract,
  portal,
  locale,
  viewer,
}: {
  contract: ContractDetail;
  portal: Portal;
  locale: 'ar' | 'en';
  viewer: Viewer;
}) {
  const ar = locale === 'ar';
  return (
    <div className="form-shell contract-detail">
      <header className="portal-topbar">
        <div>
          <span className="ops-kicker">BHD R · CONTRACT</span>
          <h1>{contract.reference}</h1>
          <p>
            {contract.kind === 'renewal'
              ? ar
                ? 'ملحق تجديد'
                : 'Renewal addendum'
              : ar
                ? 'عقد إيجار أساسي'
                : 'Initial lease contract'}{' '}
            · {contract.startsOn} — {contract.endsOn}
          </p>
        </div>
        <StatusBadge
          status={contract.status === 'signed' ? 'positive' : 'neutral'}
          label={contract.status}
        />
      </header>

      <section className="contract-detail__grid">
        <Card>
          <CardContent>
            <h2>{ar ? 'الأطراف والوحدة' : 'Parties & unit'}</h2>
            <dl className="detail-facts">
              <div>
                <dt>{ar ? 'المالك' : 'Landlord'}</dt>
                <dd>{contract.parties.owner?.displayName ?? '—'}</dd>
              </div>
              <div>
                <dt>{ar ? 'المستأجر' : 'Tenant'}</dt>
                <dd>{contract.parties.tenant?.displayName ?? viewer.displayName}</dd>
              </div>
              <div>
                <dt>{ar ? 'العقار' : 'Property'}</dt>
                <dd>
                  {contract.property
                    ? ar
                      ? contract.property.nameAr
                      : contract.property.nameEn
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>{ar ? 'الوحدة' : 'Unit'}</dt>
                <dd>
                  {contract.unit
                    ? `${contract.unit.code} · ${ar ? contract.unit.nameAr : contract.unit.nameEn}`
                    : '—'}
                </dd>
              </div>
              {contract.parentContractId ? (
                <div>
                  <dt>{ar ? 'العقد الأصلي' : 'Original contract'}</dt>
                  <dd>
                    <Link href={`/${locale}/${portal}/contracts/${contract.parentContractId}`}>
                      {ar ? 'عرض العقد المرتبط' : 'View linked contract'}
                    </Link>
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2>{ar ? 'الاعتماد والمستند' : 'Approval & document'}</h2>
            <p>
              {ar ? 'حالة الاعتماد: ' : 'Approval status: '}
              <strong>
                {contract.approval?.status ?? (ar ? 'غير مطلوب بعد' : 'Not requested')}
              </strong>
            </p>
            {contract.documentHash ? (
              <p className="muted">
                SHA-256: <code>{contract.documentHash}</code>
              </p>
            ) : (
              <p className="muted">
                {ar
                  ? 'سيُنشأ ملف PDF الآمن بعد إرسال العقد.'
                  : 'The secure PDF is generated after sending.'}
              </p>
            )}
            {contract.documentUrl ? (
              <a
                className="button button--secondary"
                href={contract.documentUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {ar ? 'فتح نسخة PDF الآمنة' : 'Open secure PDF'}
              </a>
            ) : null}
            {portal !== 'tenant' ? (
              <ContractActions
                contractId={contract.id}
                status={contract.status}
                approvalStatus={contract.approval?.status ?? null}
                locale={locale}
              />
            ) : null}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardContent>
          <h2>{ar ? 'سجل التوقيعات' : 'Signature evidence'}</h2>
          {contract.signatures.length ? (
            <ul className="contract-signatures">
              {contract.signatures.map((signature) => (
                <li key={signature.id}>
                  <strong>{signature.signerRole}</strong>
                  <span>{new Date(signature.signedAt).toLocaleString(ar ? 'ar-OM' : 'en-OM')}</span>
                  <code>{signature.signatureHash.slice(0, 20)}…</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              {ar ? 'لم يُسجل أي توقيع بعد.' : 'No signature has been recorded yet.'}
            </p>
          )}
        </CardContent>
      </Card>

      {contract.canSign ? (
        <SignatureForm contractId={contract.id} expectedName={viewer.displayName} />
      ) : null}
    </div>
  );
}
