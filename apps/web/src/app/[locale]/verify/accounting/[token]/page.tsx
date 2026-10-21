import type { Metadata } from 'next';
import { AccountingLetterheadDoc } from '@/components/accounting/accounting-letterhead-doc';
import { StayReceiptPrintButton } from '@/components/stays/stay-receipt-print-button';
import {
  loadSharedAccountingPrintDoc,
  verifyAccountingPrintToken,
} from '@/lib/accounting-letterhead-neon';
import { privatePortalRobots } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'مستند محاسبي · Accounting document',
  robots: privatePortalRobots,
};

/**
 * Public client view of a sealed accounting document (same letterhead / QR / print
 * layout the accountant sees). Opened from email, WhatsApp, or the document QR.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: rawLocale, token: rawToken } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  const token = decodeURIComponent(rawToken);
  const doc = await loadSharedAccountingPrintDoc(token, locale);
  const check = doc ? { ok: true as const } : await verifyAccountingPrintToken(token);

  if (doc) {
    return (
      <main className="dash-shell rent-doc-page" dir={ar ? 'rtl' : 'ltr'} lang={locale}>
        <div className="rent-doc-page__actions">
          <StayReceiptPrintButton
            locale={locale}
            label={ar ? '⬇ تحميل / طباعة PDF' : '⬇ Download / print PDF'}
          />
        </div>
        <p className="rent-doc-page__hint muted">
          {ar
            ? 'مستند رسمي بترويسة الشركة ورمز التحقق. لحفظه كـ PDF اختر «حفظ كـ PDF» من نافذة الطباعة.'
            : 'Official company letterhead with a verification code. To keep a PDF, choose “Save as PDF” in the print dialog.'}
        </p>
        <AccountingLetterheadDoc doc={doc} locale={locale} />
      </main>
    );
  }

  return (
    <main className="dash-shell" dir={ar ? 'rtl' : 'ltr'} lang={locale}>
      <article className="rent-doc" style={{ maxWidth: 640, margin: '2rem auto' }}>
        <h1>{ar ? 'التحقق من مستند محاسبي' : 'Accounting document verification'}</h1>
        {check.ok ? (
          <p style={{ color: '#13834f', fontWeight: 700 }}>
            {ar
              ? '✓ الرمز سليم، لكن تعذّر تحميل نص المستند الآن. أعد المحاولة بعد قليل.'
              : '✓ Token is valid, but the document body could not be loaded. Try again shortly.'}
          </p>
        ) : (
          <p style={{ color: '#b42318', fontWeight: 700 }}>
            {ar
              ? '✗ الرمز غير صالح أو تالف. لا يمكن الاعتماد على هذا المستند.'
              : '✗ Invalid or tampered token. Do not trust this document.'}
          </p>
        )}
      </article>
    </main>
  );
}
