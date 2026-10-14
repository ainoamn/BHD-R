import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { VerificationReview } from '@/components/site-admin/verification-review';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readClaims } from '@/lib/portal-ops-data';
import { isSiteAdmin } from '@/lib/stay-deposit-claims-neon';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'إدارة الموقع · توثيق الحسابات',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminVerificationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  setRequestLocale(locale);
  if (!hasDatabaseUrl()) notFound();
  const claims = await readClaims();
  if (!claims)
    redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/site-admin/verification`)}`);
  if (!(await isSiteAdmin(claims).catch(() => false))) notFound();
  return (
    <main className="account-page" dir={ar ? 'rtl' : 'ltr'}>
      <nav className="account-page__nav">
        <Link href={`/${locale}/site-admin`} className="button button--ghost button--small">
          {ar ? '→ إدارة الموقع' : '← Site admin'}
        </Link>
      </nav>
      <VerificationReview locale={locale} />
    </main>
  );
}
