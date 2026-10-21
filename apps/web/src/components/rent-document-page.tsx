import { BrandMark, EmptyState } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { RentDocumentView } from '@/components/rent-document';
import { StayReceiptPrintButton } from '@/components/stays/stay-receipt-print-button';
import { rentDocHref, rentDocKindsOf } from '@/lib/rent-documents';
import type { RentDocument } from '@/lib/rent-documents-neon';

/** Toolbar (save as PDF, the other document of the same item, back) above the document. */
export function RentDocumentPage({
  doc,
  locale,
  portal,
  backHref,
}: {
  doc: RentDocument | null;
  locale: 'ar' | 'en';
  portal: 'tenant' | 'owner';
  backHref: string;
}) {
  const ar = locale === 'ar';
  const kicker = portal === 'tenant'
    ? (ar ? 'مساحة المستأجر · مستند' : 'Tenant space · Document')
    : (ar ? 'مساحة المالك · مستند' : 'Owner space · Document');
  const backLabel = portal === 'tenant'
    ? (ar ? 'العودة لكشف الحساب' : 'Back to the statement')
    : (ar ? 'العودة لتحصيل الإيجار' : 'Back to rent collection');
  const back = (
    <Link className="button button--quiet" href={backHref}>
      {backLabel}
    </Link>
  );

  if (!doc) {
    return (
      <div className="ops-workspace ops-workspace--rent-doc rent-doc-page">
        <header className="ops-header">
          <div>
            <span className="ops-kicker">{kicker}</span>
            <h1>{ar ? 'المستند غير متاح' : 'Document not available'}</h1>
            <p>
              {ar
                ? 'قد يكون البند سُدّد بالكامل (فتجد إيصاله بدل الفاتورة)، أو لم يُسجَّل عليه أي سداد بعد، أو أنه لا يخصك.'
                : 'The item may be paid in full (open its receipt instead), have no payment recorded yet, or not be yours.'}
            </p>
          </div>
          <div className="ops-header__actions">{back}</div>
        </header>
        <section className="ops-panel">
          <div className="ops-empty">
            <span className="ops-empty__mark" aria-hidden="true">
              <BrandMark />
            </span>
            <EmptyState
              title={ar ? 'لا مستند للعرض' : 'Nothing to show'}
              description={
                ar
                  ? 'عد إلى كشف الحساب واختر فاتورة أو إيصالاً متاحاً.'
                  : 'Return to the statement and open an available invoice or receipt.'
              }
            />
          </div>
        </section>
      </div>
    );
  }

  const other = rentDocKindsOf(doc.subject).find((kind) => kind !== doc.kind);
  const title = doc.kind === 'receipt'
    ? (ar ? 'إيصال قبض' : 'Payment receipt')
    : (ar ? 'فاتورة / مطالبة' : 'Invoice / demand');
  const statusTone = doc.subject.settled
    ? 'ops-status ops-status--positive'
    : doc.subject.outstandingMinor !== '0'
      ? 'ops-status ops-status--warning'
      : 'ops-status ops-status--neutral';
  const statusLabel = doc.subject.settled
    ? (ar ? 'مسدد' : 'Settled')
    : doc.kind === 'invoice'
      ? (ar ? 'مستحق' : 'Due')
      : (ar ? 'مدفوع جزئياً' : 'Part paid');

  return (
    <div className="ops-workspace ops-workspace--rent-doc rent-doc-page">
      <header className="ops-header">
        <div>
          <span className="ops-kicker">{kicker}</span>
          <h1>{title}</h1>
          <p>
            {ar ? doc.subject.label.ar : doc.subject.label.en}
            {doc.subject.invoiceNumber ? (
              <>
                {' · '}
                <bdi dir="ltr">{doc.subject.invoiceNumber}</bdi>
              </>
            ) : null}
          </p>
          <p className="rent-doc-page__status-row">
            <span className={statusTone}>{statusLabel}</span>
          </p>
        </div>
        <div className="ops-header__actions">
          <StayReceiptPrintButton
            locale={locale}
            label={ar ? 'تحميل / طباعة PDF' : 'Download / print PDF'}
          />
          {other ? (
            <Link
              className="button button--quiet"
              href={rentDocHref(portal, doc.leaseId, doc.subject.key, other)}
            >
              {other === 'receipt'
                ? (ar ? 'إيصال القبض' : 'Receipt')
                : (ar ? 'فاتورة المتبقي' : 'Balance invoice')}
            </Link>
          ) : null}
          {back}
        </div>
      </header>
      <p className="rent-doc-page__hint muted">
        {ar
          ? 'لحفظ المستند كملف PDF اختر «حفظ كـ PDF» في نافذة الطباعة. المستند أدناه بنفس وضوح الطباعة.'
          : 'To keep it as a PDF, choose “Save as PDF” in the print dialog. The document below matches print quality.'}
      </p>
      <section className="ops-panel ops-panel--rent-doc">
        <RentDocumentView doc={doc} locale={locale} />
      </section>
    </div>
  );
}
