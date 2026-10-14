import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { AccountCenter } from '@/components/account/account-center';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readClaims } from '@/lib/portal-ops-data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'حسابي والتوثيق · My account',
  robots: { index: false, follow: false, nocache: true },
};

/** Any signed-in person: their picture, verified tick, verification requests and business logos. */
export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  setRequestLocale(locale);
  if (!hasDatabaseUrl()) notFound();
  const claims = await readClaims();
  if (!claims) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/account`)}`);
  return (
    <main className="account-page" dir={ar ? 'rtl' : 'ltr'}>
      <nav className="account-page__nav">
        <Link href={`/${locale}/portal`} className="button button--ghost button--small">
          {ar ? '→ البوابة' : '← Portal'}
        </Link>
      </nav>
      <AccountCenter locale={locale} />
    </main>
  );
}
