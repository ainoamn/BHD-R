import { setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { StayDepositSettlementDocument } from '@/components/stays/stay-deposit-settlement-document';
import { StayReceiptPrintButton } from '@/components/stays/stay-receipt-print-button';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { depositTransferReceiptHref } from '@/lib/stay-deposit-settlement-docs';
import { loadGuestDepositSettlementDoc } from '@/lib/stay-deposit-settlement-docs-neon';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';

export const dynamic = 'force-dynamic';

export default async function StayDepositSettlementDocsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isStaysPublicSurfaceEnabled() || !hasDatabaseUrl()) notFound();
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const ar = locale === 'ar';

  const refRaw = query.ref;
  const ref = typeof refRaw === 'string' ? refRaw : Array.isArray(refRaw) ? refRaw[0] : undefined;
  const docRaw = query.doc;
  const docKind =
    typeof docRaw === 'string' ? docRaw : Array.isArray(docRaw) ? docRaw[0] : 'refund';
  if (!ref || (docKind !== 'refund' && docKind !== 'transfer')) notFound();

  if (docKind === 'transfer') {
    redirect(depositTransferReceiptHref(ref));
  }

  const lang = locale === 'en' ? 'en' : 'ar';
  const doc = await loadGuestDepositSettlementDoc(ref, lang);
  if (!doc || doc.refundStatus !== 'executed') notFound();

  return (
    <div className="dash-shell rent-doc-page stays-booking-receipt">
      <div className="rent-doc-page__actions">
        <StayReceiptPrintButton
          locale={locale}
          label={ar ? '⬇ تحميل / طباعة PDF' : '⬇ Download / print PDF'}
        />
        {doc.hasTransferReceipt ? (
          <a
            className="button button--quiet"
            href={depositTransferReceiptHref(doc.referenceCode)}
            target="_blank"
            rel="noreferrer"
          >
            {ar ? 'إيصال التحويل' : 'Transfer receipt'}
          </a>
        ) : null}
        <Link
          className="button button--quiet"
          href={`/stays/booking/confirmed?ref=${encodeURIComponent(ref)}`}
        >
          {ar ? 'العودة للتأكيد' : 'Back to confirmation'}
        </Link>
      </div>
      <p className="rent-doc-page__hint muted">
        {ar
          ? 'مستند محاسبي رسمي بترويسة الشركة واعتماد إلكتروني وباركود تحقق — نفس المستند في أمانات التأمين.'
          : 'Official accounting document with company letterhead, electronic approval and a verification barcode — the same document on the deposits tab.'}
      </p>
      <StayDepositSettlementDocument doc={doc} locale={locale} />
    </div>
  );
}
