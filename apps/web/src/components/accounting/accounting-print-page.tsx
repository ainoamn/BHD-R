'use client';

import { Link } from '@/i18n/navigation';
import { AccountingLetterheadDoc } from '@/components/accounting/accounting-letterhead-doc';
import { StayReceiptPrintButton } from '@/components/stays/stay-receipt-print-button';
import type { AccountingPrintDoc } from '@/lib/accounting-letterhead';

/** Toolbar + letterheaded document; print uses the same PDF dialog as rent invoices. */
export function AccountingPrintPage({
  doc,
  locale,
  backHref,
}: {
  doc: AccountingPrintDoc | null;
  locale: 'ar' | 'en';
  /** Hub URL to restore (tab / open journal), never the bare dashboard when avoidable. */
  backHref: string;
}) {
  const ar = locale === 'ar';
  const back = (
    <Link className="button button--quiet" href={backHref}>
      {ar ? 'العودة للمحاسبة' : 'Back to accounting'}
    </Link>
  );
  if (!doc) {
    return (
      <div className="dash-shell rent-doc-page">
        <p className="accounting-hub__error">
          {ar ? 'المستند غير متاح أو لا تملك صلاحية عرضه.' : 'Document unavailable or not allowed.'}
        </p>
        {back}
      </div>
    );
  }
  return (
    <div className="dash-shell rent-doc-page">
      <div className="rent-doc-page__actions">
        <StayReceiptPrintButton
          locale={locale}
          label={ar ? '⬇ تحميل / طباعة PDF' : '⬇ Download / print PDF'}
        />
        {back}
      </div>
      <p className="rent-doc-page__hint muted">
        {ar
          ? 'لحفظ المستند كملف PDF اختر «حفظ كـ PDF» في نافذة الطباعة. الترويسة والتوقيع الإلكتروني مطابقان لفواتير الإيجار.'
          : 'To keep it as a PDF, choose “Save as PDF” in the print dialog. Letterhead and e-signature match rent invoices.'}
      </p>
      <AccountingLetterheadDoc doc={doc} locale={locale} />
    </div>
  );
}
