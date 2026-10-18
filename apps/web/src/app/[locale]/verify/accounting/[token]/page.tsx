import type { Metadata } from 'next';
import { verifyAccountingPrintToken } from '@/lib/accounting-letterhead-neon';
import { privatePortalRobots } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تحقق محاسبي · Accounting verify',
  robots: privatePortalRobots,
};

/** Public check for an accounting letterhead QR / signature token. */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: rawLocale, token } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  const result = await verifyAccountingPrintToken(decodeURIComponent(token));
  return (
    <main className="dash-shell" dir={ar ? 'rtl' : 'ltr'} lang={locale}>
      <article className="rent-doc" style={{ maxWidth: 640, margin: '2rem auto' }}>
        <h1>{ar ? 'التحقق من مستند محاسبي' : 'Accounting document verification'}</h1>
        {result.ok ? (
          <>
            <p style={{ color: '#13834f', fontWeight: 700 }}>
              {ar ? '✓ الرمز سليم — المستند صادر عبر منصة BHD R.' : '✓ Token valid — issued via BHD R.'}
            </p>
            {result.fingerprintPrefix ? (
              <p>
                {ar ? 'بداية البصمة:' : 'Fingerprint prefix:'}{' '}
                <code dir="ltr">{result.fingerprintPrefix}</code>
              </p>
            ) : null}
          </>
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
