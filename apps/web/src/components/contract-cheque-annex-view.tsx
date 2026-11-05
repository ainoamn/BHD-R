import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContractDocumentToolbar } from '@/components/contract-document-toolbar';
import {
  BRAND_LOGO,
  DocLetterhead,
  contractKit,
  contractSerif,
  ltr,
  type Pair,
} from '@/components/contract-doc-parts';
import type { ContractChequeKind, ContractChequeRow } from '@/lib/contract-cheque-annex';
import { loadContractDetailFromNeon } from '@/lib/contract-detail-neon';
import { formatMoney } from '@/lib/format';
import type { PortalRole } from '@/lib/types';
import { requirePortal } from '@/lib/viewer';

type Portal = Exclude<PortalRole, 'platform'>;

const DOCUMENT_ID = 'contract-cheque-annex';

const KIND_LABEL: Record<ContractChequeKind, Pair> = {
  rent: ['إيجار', 'Rent'],
  vat: ['ضريبة', 'VAT'],
  deposit: ['تأمين', 'Deposit'],
};

function holderName(value: string | null): string | null {
  return value && /\p{L}/u.test(value) ? value : null;
}

export async function ContractChequeAnnexView({
  portal,
  locale,
  contractId,
}: {
  portal: Portal;
  locale: string;
  contractId: string;
}) {
  const lang = locale === 'en' ? 'en' : 'ar';
  await requirePortal(lang, portal);
  const detail = await loadContractDetailFromNeon(contractId, portal).catch((error: unknown) => {
    console.error('cheque annex failed', error);
    return null;
  });
  const annex = detail?.document?.chequeAnnex ?? null;
  if (!detail?.document || !annex) notFound();

  const ar = lang === 'ar';
  const doc = detail.document;
  const title = ar ? 'ملحق الشيكات' : 'Cheque annex';
  const contractHref = `/${lang}/${portal}/contracts/${detail.id}`;
  const summary = ar
    ? `${title} · ${annex.reference} متمّم للعقد ${detail.reference}`
    : `${title} · ${annex.reference} completing contract ${detail.reference}`;

  return (
    <div className="form-shell contract-detail contract-detail--document">
      <header className="portal-topbar contract-detail__topbar">
        <div>
          <span className="ops-kicker">BHD R · CHEQUE ANNEX</span>
          <h1 dir="ltr">{annex.reference}</h1>
          <p>
            {title} · {ar ? 'ملحق متمّم للعقد' : 'Annex completing'}{' '}
            <bdi dir="ltr">{detail.reference}</bdi>
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
            : {
                name: doc.tenant?.name ?? null,
                email: doc.tenant?.email ?? doc.tenantContact?.email ?? null,
                phone: doc.tenant?.phone ?? doc.tenantContact?.phone ?? null,
              }
        }
        recipientPath={null}
        pdfUrl={null}
      />
      <ChequeAnnexArticle
        id={DOCUMENT_ID}
        locale={lang}
        contractReference={detail.reference}
        annexReference={annex.reference}
        rows={annex.rows}
        letterhead={doc.letterhead}
        ownerName={doc.owner?.name ?? '—'}
        propertyName={
          doc.premises
            ? [doc.premises.propertyNameAr, doc.premises.propertyNameEn]
            : null
        }
        unitCode={doc.premises?.unit?.code ?? null}
      />
    </div>
  );
}

function ChequeAnnexArticle({
  id,
  locale,
  contractReference,
  annexReference,
  rows,
  letterhead,
  ownerName,
  propertyName,
  unitCode,
}: {
  id: string;
  locale: 'ar' | 'en';
  contractReference: string;
  annexReference: string;
  rows: ContractChequeRow[];
  letterhead: Parameters<typeof DocLetterhead>[0]['letterhead'];
  ownerName: string;
  propertyName: Pair | null;
  unitCode: string | null;
}) {
  const ar = locale === 'ar';
  const { bi, para } = contractKit(ar);
  const money = (minor: string, currency: string): Pair => [
    formatMoney(minor, currency, 'ar'),
    formatMoney(minor, currency, 'en'),
  ];

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
        <tbody>
          <tr>
            <td>
              <header className="contract-doc__title">
                <h1>{ar ? 'ملحق الشيكات' : 'Cheque annex'}</h1>
                <p className="contract-doc__title-alt" lang={ar ? 'en' : 'ar'} dir={ar ? 'ltr' : 'rtl'}>
                  {ar ? 'Cheque annex' : 'ملحق الشيكات'}
                </p>
                <p dir="ltr">{annexReference}</p>
              </header>
              {para(
                `هذا الملحق متمّم للعقد ${contractReference} وجزء لا يتجزأ منه، ويبين أرقام الشيكات ومبالغها وتواريخ استحقاقها المتفق عليها بين الطرفين.`,
                `This annex completes contract ${contractReference} and forms an integral part of it. It sets out the cheque numbers, amounts and due dates agreed by the parties.`,
                'contract-doc__lead',
              )}
              {propertyName || unitCode ? (
                <p className="contract-doc__lead">
                  {propertyName ? bi(propertyName) : null}
                  {unitCode ? <> · {ltr(unitCode)}</> : null}
                </p>
              ) : null}
              <table className="contract-doc__compare">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{bi(['البيان', 'Item'])}</th>
                    <th>{bi(['الاستحقاق', 'Due'])}</th>
                    <th>{bi(['المبلغ', 'Amount'])}</th>
                    <th>{bi(['رقم الشيك', 'Cheque no.'])}</th>
                    <th>{bi(['البنك', 'Bank'])}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.key}>
                      <td>{index + 1}</td>
                      <td>
                        {bi([row.labelAr, row.labelEn])}
                        <div>
                          <small>{bi(KIND_LABEL[row.kind])}</small>
                        </div>
                      </td>
                      <td dir="ltr">{row.dueOn ?? '—'}</td>
                      <td>{bi(money(row.amountMinor, row.currency))}</td>
                      <td dir="ltr">{row.chequeNumber ?? '—'}</td>
                      <td>
                        {row.bankName ?? '—'}
                        {holderName(row.accountHolderName) ? (
                          <div>
                            <small>{holderName(row.accountHolderName)}</small>
                          </div>
                        ) : null}
                        {row.accountNumber ? (
                          <div>
                            <small dir="ltr">{row.accountNumber}</small>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {para(
                'تُفسَّر أحكام هذا الملحق مع العقد الأصلي معاً، ولا يُعدّ غياب رقم شيك في خانةٍ تنازلاً عن القسط المقابل.',
                'This annex is read together with the original contract. A blank cheque number does not waive the corresponding instalment.',
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}
