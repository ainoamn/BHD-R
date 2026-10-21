import { EmptyState } from '@bhd-r/ui';
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
  const back = (
    <Link className="button button--quiet" href={backHref}>
      {portal === 'tenant'
        ? ar
          ? 'العودة لكشف الحساب'
          : 'Back to the statement'
        : ar
          ? 'العودة لتحصيل الإيجار'
          : 'Back to rent collection'}
    </Link>
  );
  if (!doc) {
    return (
      <div className="dash-shell rent-doc-page">
        <EmptyState
          title={ar ? 'المستند غير متاح' : 'Document not available'}
          description={
            ar
              ? 'قد يكون البند سُدّد بالكامل (فتجد إيصاله بدل الفاتورة)، أو لم يُسجَّل عليه أي سداد بعد، أو أنه لا يخصك.'
              : 'The item may be paid in full (open its receipt instead), have no payment recorded yet, or not be yours.'
          }
        />
        <div className="rent-doc-page__actions">{back}</div>
      </div>
    );
  }
  const other = rentDocKindsOf(doc.subject).find((kind) => kind !== doc.kind);
  return (
    <div className="dash-shell rent-doc-page">
      <div className="rent-doc-page__actions">
        <StayReceiptPrintButton
          locale={locale}
          label={ar ? '⬇ تحميل / طباعة PDF' : '⬇ Download / print PDF'}
        />
        {other ? (
          <Link
            className="button button--quiet"
            href={rentDocHref(portal, doc.leaseId, doc.subject.key, other)}
          >
            {other === 'receipt'
              ? ar
                ? '🧾 إيصال القبض'
                : '🧾 Receipt'
              : ar
                ? '📄 فاتورة المتبقي'
                : '📄 Balance invoice'}
          </Link>
        ) : null}
        {back}
      </div>
      <p className="rent-doc-page__hint muted">
        {ar
          ? 'لحفظ المستند كملف PDF اختر «حفظ كـ PDF» في نافذة الطباعة.'
          : 'To keep it as a PDF, choose “Save as PDF” in the print dialog.'}
      </p>
      <RentDocumentView doc={doc} locale={locale} />
    </div>
  );
}
