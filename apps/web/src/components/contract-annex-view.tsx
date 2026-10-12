import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ANNEX_META,
  type ContractAnnexDocument,
  type ContractAnnexKind,
} from '@/lib/contract-annex';
import { loadContractAnnexFromNeon } from '@/lib/contract-annex-neon';
import { formatMoney } from '@/lib/format';
import { HANDOVER_DOCUMENT_KINDS, handoverNote } from '@/lib/stay-handover';
import type { PortalRole } from '@/lib/types';
import { requirePortal } from '@/lib/viewer';
import {
  BRAND_LOGO,
  DocLetterhead,
  contractKit,
  contractSerif,
  ltr,
  type Pair,
} from './contract-doc-parts';
import { ContractDocumentToolbar } from './contract-document-toolbar';

type Portal = Exclude<PortalRole, 'platform'>;

const DOCUMENT_ID = 'contract-annex-document';

const REFUND_STATUS: Record<string, Pair> = {
  requested: ['قيد مراجعة المالك', 'Awaiting the host'],
  approved: ['معتمد — بانتظار التحويل', 'Approved — awaiting transfer'],
  rejected: ['مرفوض', 'Declined'],
  executed: ['حُوّل المبلغ', 'Transferred'],
};

const PAYOUT_METHOD: Record<string, Pair> = {
  bank: ['حساب بنكي', 'Bank account'],
  phone: ['تحويل عبر الهاتف', 'Mobile transfer'],
};

const PHOTO_SOURCE: Record<string, Pair> = {
  camera: ['تصوير فوري', 'Live photo'],
  device: ['من الجهاز', 'From device'],
};

/**
 * One annex of a stay lease as its own document: same letterhead, typeface and colours as
 * the contract, its own number and print button, and signature lines to sign on paper.
 */
export async function ContractAnnexView({
  portal,
  locale,
  contractId,
  kind,
}: {
  portal: Portal;
  locale: string;
  contractId: string;
  kind: ContractAnnexKind;
}) {
  const lang = locale === 'en' ? 'en' : 'ar';
  await requirePortal(lang, portal);
  const annex = await loadContractAnnexFromNeon(contractId, portal, kind).catch(
    (error: unknown) => {
      console.error('contract annex (neon) failed', error);
      return null;
    },
  );
  if (!annex) notFound();
  return <ContractAnnexDocumentView annex={annex} portal={portal} lang={lang} />;
}

export function ContractAnnexDocumentView({
  annex,
  portal,
  lang,
}: {
  annex: ContractAnnexDocument;
  portal: Portal;
  lang: 'ar' | 'en';
}) {
  const ar = lang === 'ar';
  const { kind } = annex;
  const kit = contractKit(ar);
  const { bi, row, para, order } = kit;
  const meta = ANNEX_META[kind];
  const [titleAr, titleEn] = meta.title;
  const title = ar ? titleAr : titleEn;
  const contractHref = `/${lang}/${portal}/contracts/${annex.contract.id}`;
  const formatDateTime = (iso: string, target: 'ar' | 'en') =>
    new Date(iso).toLocaleString(target === 'ar' ? 'ar-OM' : 'en-GB', {
      timeZone: 'Asia/Muscat',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  const dateTime = (iso: string | null | undefined): Pair | null =>
    iso ? [formatDateTime(iso, 'ar'), formatDateTime(iso, 'en')] : null;
  const money = (minor: string | null | undefined, currency: string): Pair | null =>
    minor ? [formatMoney(minor, currency, 'ar'), formatMoney(minor, currency, 'en')] : null;
  const propertyName: Pair | null = annex.property
    ? [annex.property.nameAr, annex.property.nameEn]
    : null;
  const unitLabel = (code: string, name: string) =>
    name.includes(code) ? name : `${code} · ${name}`;
  const unitName: Pair | null = annex.unit
    ? [unitLabel(annex.unit.code, annex.unit.nameAr), unitLabel(annex.unit.code, annex.unit.nameEn)]
    : null;
  const handover = annex.handover;
  const refund = annex.refund;
  const stampKind = kind === 'check-out' ? 'check_out' : 'check_in';
  const documentKind = handover?.recipient?.documentKind
    ? HANDOVER_DOCUMENT_KINDS.find((item) => item.key === handover.recipient?.documentKind)
    : null;
  const presets = (handover?.noteKeys ?? [])
    .map((key) => handoverNote(stampKind, key))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const summary = ar
    ? `${titleAr} · ملحق ${annex.reference} للعقد ${annex.contract.reference}`
    : `${titleEn} · annex ${annex.reference} to contract ${annex.contract.reference}`;

  let index = 0;
  const heading = ([headAr, headEn]: Pair) => {
    index += 1;
    return (
      <h2 className="contract-doc__heading">
        {order(
          <span key="ar" lang="ar" dir="rtl">
            <span className="contract-doc__ordinal">{index}.</span> {headAr}
          </span>,
          <span key="en" lang="en" dir="ltr">
            <span className="contract-doc__ordinal">{index}.</span> {headEn}
          </span>,
        )}
      </h2>
    );
  };

  const signBox = (role: Pair, name: string | null, at: string | null, electronic: boolean) => (
    <div className="contract-doc__signature">
      <span className="contract-doc__party-role">{bi(role)}</span>
      <div className="contract-doc__signature-mark contract-annex__sign-line">
        {electronic ? (
          <span className="contract-doc__signature-seal">
            {bi(['سُجّل إلكترونياً', 'Recorded electronically'])}
          </span>
        ) : null}
      </div>
      <dl className="contract-doc__signature-facts">
        {row(['الاسم', 'Name'], name ? <bdi>{name}</bdi> : null)}
        {row(['التاريخ', 'Date'], at ? bi(dateTime(at)) : null)}
      </dl>
    </div>
  );

  return (
    <div className="form-shell contract-detail contract-detail--document">
      <header className="portal-topbar contract-detail__topbar">
        <div>
          <span className="ops-kicker">BHD R · CONTRACT ANNEX</span>
          <h1 dir="ltr">{annex.reference}</h1>
          <p>
            {title} · {ar ? 'ملحق للعقد' : 'Annex to'}{' '}
            <bdi dir="ltr">{annex.contract.reference}</bdi>
          </p>
        </div>
        <Link className="button button--quiet" href={contractHref}>
          {ar ? 'العودة إلى العقد' : 'Back to the contract'}
        </Link>
      </header>

      <ContractDocumentToolbar
        ar={ar}
        documentId={DOCUMENT_ID}
        title={title}
        reference={annex.reference}
        summary={summary}
        recipient={
          portal === 'tenant'
            ? null
            : { name: annex.tenantName, email: annex.tenantEmail, phone: annex.tenantPhone }
        }
        recipientPath={
          portal === 'tenant' ? null : annex.guestPageHref ? `/${lang}${annex.guestPageHref}` : null
        }
        pdfUrl={null}
      />

      <article
        id={DOCUMENT_ID}
        className={`contract-doc contract-annex ${contractSerif.variable}`}
        dir={ar ? 'rtl' : 'ltr'}
        lang={lang}
      >
        <div className="contract-doc__page-frame" aria-hidden="true" />
        <img
          className="contract-doc__watermark"
          src={annex.letterhead?.logoDataUrl || BRAND_LOGO}
          alt=""
          aria-hidden="true"
        />
        <table className="contract-doc__frame">
          <thead>
            <tr>
              <td>
                <DocLetterhead letterhead={annex.letterhead} fallbackName={annex.ownerName} />
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
                      <span>{bi(['رقم الملحق', 'Annex No.'])}</span>
                      <strong>
                        <bdi dir="ltr">{annex.reference}</bdi>
                      </strong>
                    </div>
                    <div>
                      <span>{bi(['العقد الأصلي', 'Contract No.'])}</span>
                      <strong>
                        <Link href={contractHref}>
                          <bdi dir="ltr">{annex.contract.reference}</bdi>
                        </Link>
                      </strong>
                    </div>
                    <div>
                      <span>{bi(['تاريخ التسجيل', 'Recorded'])}</span>
                      <strong>{bi(dateTime(annex.recordedAt))}</strong>
                    </div>
                  </div>
                </div>

                {para(
                  `هذا الملحق رقم ${meta.number} جزء لا يتجزأ من العقد رقم ${annex.contract.reference} ومتمّم له. ${meta.lead[0]}`,
                  `This annex No. ${meta.number} forms an integral part of agreement ${annex.contract.reference} and completes it. ${meta.lead[1]}`,
                  'contract-doc__preamble',
                )}

                <section className="contract-doc__section">
                  {heading(['الأطراف والعين المؤجرة', 'Parties & Premises'])}
                  <dl className="contract-doc__table">
                    {row(
                      ['الطرف الأول — المؤجر', 'First party — Landlord'],
                      <bdi>{annex.ownerName}</bdi>,
                    )}
                    {row(
                      ['الطرف الثاني — الضيف المستأجر', 'Second party — Guest'],
                      <bdi>{annex.tenantName}</bdi>,
                    )}
                    {row(['العقار', 'Property'], bi(propertyName))}
                    {row(['الوحدة', 'Unit'], bi(unitName))}
                    {annex.bookingReference
                      ? row(['مرجع الحجز', 'Booking reference'], ltr(annex.bookingReference))
                      : null}
                  </dl>
                </section>

                {handover ? (
                  <section className="contract-doc__section">
                    {heading(
                      kind === 'check-in'
                        ? ['بيانات الاستلام', 'Check-in details']
                        : ['بيانات الإعادة', 'Check-out details'],
                    )}
                    <dl className="contract-doc__table">
                      {row(
                        kind === 'check-in'
                          ? ['تاريخ ووقت الاستلام', 'Checked in at']
                          : ['تاريخ ووقت المغادرة', 'Checked out at'],
                        bi(dateTime(handover.at)),
                      )}
                      {row(
                        ['سجّله', 'Recorded by'],
                        handover.recordedBy ? <bdi>{handover.recordedBy}</bdi> : null,
                      )}
                      {handover.recipient
                        ? row(
                            ['المستلم', 'Received by'],
                            <span className="contract-doc__stack">
                              {handover.recipient.name ? (
                                <bdi>{handover.recipient.name}</bdi>
                              ) : null}
                              {handover.recipient.phone ? (
                                <bdi dir="ltr" className="contract-doc__nowrap">
                                  {handover.recipient.phone}
                                </bdi>
                              ) : null}
                            </span>,
                          )
                        : null}
                      {handover.recipient && documentKind
                        ? row(
                            ['وثيقة المستلم', 'Recipient ID'],
                            <>
                              {bi([documentKind.ar, documentKind.en])}
                              {handover.recipient.documentHref ? (
                                <a
                                  className="contract-doc__doc-link"
                                  href={handover.recipient.documentHref}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {bi(['عرض صورة الوثيقة', 'View ID photo'])}
                                </a>
                              ) : null}
                            </>,
                          )
                        : null}
                      {row(
                        ['الملاحظات', 'Notes'],
                        presets.length || handover.customNote || handover.notes ? (
                          <>
                            {handover.important ? (
                              <span className="contract-doc__important">
                                {bi(['ملاحظة مهمة', 'Important note'])}
                              </span>
                            ) : null}
                            {presets.length || handover.customNote ? (
                              <ul className="contract-doc__note-list">
                                {presets.map((item) => (
                                  <li key={item.key}>{bi([item.ar, item.en])}</li>
                                ))}
                                {handover.customNote ? (
                                  <li>
                                    <bdi>{handover.customNote}</bdi>
                                  </li>
                                ) : null}
                              </ul>
                            ) : (
                              <span className="contract-doc__note">{handover.notes}</span>
                            )}
                          </>
                        ) : (
                          bi(['لا توجد', 'None'])
                        ),
                        true,
                      )}
                    </dl>
                  </section>
                ) : null}

                {handover ? (
                  <section className="contract-doc__section">
                    {heading(['صور حالة الوحدة', 'Unit condition photos'])}
                    {handover.photos.length ? (
                      <ol className="contract-annex__photos">
                        {handover.photos.map((photo) => (
                          <li key={photo.index}>
                            <a href={photo.src} target="_blank" rel="noreferrer">
                              <img
                                src={photo.src}
                                alt={ar ? `صورة ${photo.index + 1}` : `Photo ${photo.index + 1}`}
                                loading="lazy"
                              />
                            </a>
                            <small>
                              <strong>{photo.index + 1}</strong> ·{' '}
                              {bi(PHOTO_SOURCE[photo.source] ?? null)}
                              {photo.takenAt ? <> · {bi(dateTime(photo.takenAt))}</> : null}
                            </small>
                            <code dir="ltr">SHA-256 {photo.sha256.slice(0, 16)}…</code>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      para(
                        'لم تُرفق صور لحالة الوحدة في هذا المحضر.',
                        'No condition photos were attached to this record.',
                        'contract-doc__lead',
                      )
                    )}
                  </section>
                ) : null}

                {refund ? (
                  <>
                    <section className="contract-doc__section">
                      {heading(['طلب الاسترداد', 'Refund request'])}
                      <dl className="contract-doc__table">
                        {row(
                          ['مبلغ التأمين', 'Security deposit'],
                          bi(money(refund.depositMinor, refund.currency)),
                        )}
                        {row(['تاريخ الطلب', 'Requested at'], bi(dateTime(refund.requestedAt)))}
                        {row(
                          ['مقدّم الطلب', 'Requested by'],
                          bi(
                            refund.requestedBy === 'guest'
                              ? ['الضيف من صفحة حجزه', 'The guest, from their stay page']
                              : ['المالك', 'The host'],
                          ),
                        )}
                        {refund.consent
                          ? row(
                              ['موافقة الضيف على الشروط', 'Guest accepted the terms'],
                              <span className="contract-doc__stack">
                                {bi(dateTime(refund.consent.acceptedAt))}
                                <small dir="ltr">{refund.consent.version}</small>
                              </span>,
                            )
                          : null}
                        {refund.guestPayout
                          ? row(
                              ['طريقة التحويل والحساب', 'Requested payout'],
                              <span className="contract-doc__stack">
                                {bi(PAYOUT_METHOD[refund.guestPayout.method] ?? null)}
                                {refund.guestPayout.bank ? (
                                  <bdi>{refund.guestPayout.bank}</bdi>
                                ) : null}
                                {ltr(refund.guestPayout.account)}
                              </span>,
                            )
                          : null}
                        {refund.guestPayout?.phone
                          ? row(
                              refund.guestPayout.method === 'phone'
                                ? ['هاتف التحويل', 'Transfer phone']
                                : ['هاتف للتواصل فقط', 'Contact phone only'],
                              ltr(refund.guestPayout.phone),
                            )
                          : null}
                        {refund.guestNote
                          ? row(['ملاحظة الضيف', 'Guest note'], <bdi>{refund.guestNote}</bdi>, true)
                          : null}
                      </dl>
                    </section>

                    <section className="contract-doc__section">
                      {heading(['القرار والتحويل', 'Decision & transfer'])}
                      <dl className="contract-doc__table">
                        {row(['الحالة', 'Status'], bi(REFUND_STATUS[refund.status] ?? null))}
                        {refund.status !== 'rejected'
                          ? row(
                              ['المبلغ المعتمد', 'Approved amount'],
                              refund.decidedAt
                                ? bi(money(refund.amountMinor, refund.currency))
                                : null,
                            )
                          : null}
                        {row(
                          refund.status === 'rejected'
                            ? ['تاريخ الرفض', 'Declined at']
                            : ['تاريخ الاعتماد', 'Approved at'],
                          refund.decidedAt ? bi(dateTime(refund.decidedAt)) : null,
                        )}
                        {row(
                          ['صاحب القرار', 'Decided by'],
                          refund.decidedBy ? <bdi>{refund.decidedBy}</bdi> : null,
                        )}
                        {refund.decisionNote
                          ? row(
                              refund.status === 'rejected'
                                ? ['سبب الرفض', 'Reason']
                                : ['ملاحظة المالك', 'Host note'],
                              <bdi>{refund.decisionNote}</bdi>,
                              true,
                            )
                          : null}
                        {refund.transfer ? (
                          <>
                            {row(
                              ['تاريخ التحويل', 'Transferred at'],
                              bi(dateTime(refund.transfer.at)),
                            )}
                            {row(
                              ['حُوّل إلى', 'Paid to'],
                              <span className="contract-doc__stack">
                                {bi(PAYOUT_METHOD[refund.transfer.method] ?? null)}
                                {refund.transfer.bank ? <bdi>{refund.transfer.bank}</bdi> : null}
                                {ltr(refund.transfer.account)}
                                {refund.transfer.holder ? (
                                  <bdi>{refund.transfer.holder}</bdi>
                                ) : null}
                              </span>,
                            )}
                            {row(
                              ['مرجع التحويل', 'Transfer reference'],
                              ltr(refund.transfer.reference),
                            )}
                            {row(
                              ['سجّله المحاسب', 'Recorded by'],
                              refund.transfer.recordedBy ? (
                                <bdi>{refund.transfer.recordedBy}</bdi>
                              ) : null,
                            )}
                            {refund.transfer.receiptHref
                              ? row(
                                  ['إيصال التحويل', 'Transfer receipt'],
                                  <a
                                    className="contract-doc__doc-link"
                                    href={refund.transfer.receiptHref}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {bi(['عرض الإيصال', 'View receipt'])}
                                  </a>,
                                )
                              : null}
                          </>
                        ) : null}
                      </dl>
                    </section>
                  </>
                ) : null}

                <section className="contract-doc__section contract-doc__section--signatures">
                  {heading(['التواقيع', 'Signatures'])}
                  {para(
                    'يقرّ الموقّعون أدناه بصحة ما ورد في هذا الملحق، بما فيه الصور المرفقة.',
                    'The undersigned confirm the contents of this annex, including the attached photos.',
                    'contract-doc__lead',
                  )}
                  <div className="contract-doc__signatures">
                    {handover ? (
                      <>
                        {signBox(
                          ['الطرف الأول — المؤجر أو ممثله', 'First party — Landlord or agent'],
                          handover.recordedBy,
                          handover.at,
                          true,
                        )}
                        {signBox(
                          kind === 'check-in'
                            ? ['الطرف الثاني — المستلم', 'Second party — Recipient']
                            : ['الطرف الثاني — الضيف', 'Second party — Guest'],
                          handover.recipient?.name ?? annex.tenantName,
                          null,
                          false,
                        )}
                      </>
                    ) : refund ? (
                      <>
                        {signBox(
                          ['الطرف الأول — صاحب القرار', 'First party — Decided by'],
                          refund.decidedBy,
                          refund.decidedAt,
                          Boolean(refund.decidedAt),
                        )}
                        {signBox(
                          ['الطرف الثاني — الضيف المستلم للمبلغ', 'Second party — Guest (payee)'],
                          annex.tenantName,
                          null,
                          false,
                        )}
                      </>
                    ) : null}
                  </div>
                </section>

                <div className="contract-doc__integrity">
                  <div>
                    {para(
                      `صدر هذا الملحق إلكترونياً عبر منصة BHD R، وهو جزء لا يتجزأ من العقد رقم ${annex.contract.reference}. البصمة أدناه تتغيّر عند أي تعديل في بياناته أو صوره.`,
                      `Issued electronically via BHD R as an integral part of agreement ${annex.contract.reference}. The fingerprint below changes if any of its data or photos change.`,
                    )}
                    <code dir="ltr">SHA-256 {annex.fingerprint}</code>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <footer className="contract-doc__pagefoot">
          <span>
            {titleAr} · {titleEn} · <bdi dir="ltr">{annex.reference}</bdi>
          </span>
          <span dir="ltr">Annex to {annex.contract.reference}</span>
        </footer>
      </article>
    </div>
  );
}
