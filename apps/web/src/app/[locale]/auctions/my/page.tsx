import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import '../../../marketplace.css';
import '../../../auctions-projects.css';
import { MarketplaceShell } from '@/components/marketplace/marketplace-shell';
import { Link } from '@/i18n/navigation';
import { bilingualAlternates } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const ar = locale !== 'en';
  return {
    title: ar ? 'مزاداتي' : 'My auctions',
    alternates: bilingualAlternates(locale, '/auctions/my'),
  };
}

export default async function MyAuctionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  setRequestLocale(locale);
  const { assertPublicSitePage } = await import('@/lib/site-page-gate');
  await assertPublicSitePage('auctions');
  const signIn = `/api/auth/bhd/start?returnTo=${encodeURIComponent(`/${locale}/auctions/my`)}`;

  return (
    <MarketplaceShell
      locale={locale}
      kicker={ar ? 'حسابي' : 'My account'}
      title={ar ? 'مزاداتي' : 'My auctions'}
      lead={
        ar
          ? 'تابع المزادات التي أنشأتها أو شاركت فيها بعد تسجيل الدخول.'
          : 'Track auctions you created or joined after signing in.'
      }
      actions={
        <>
          <a className="button button--gold button--small" href={signIn}>
            {ar ? 'تسجيل الدخول' : 'Sign in'}
          </a>
          <Link className="button button--secondary button--small" href="/auctions">
            {ar ? 'كل المزادات' : 'All auctions'}
          </Link>
        </>
      }
    >
      <p className="ap-empty">
        {ar
          ? 'لا توجد مزادات مرتبطة بهذا الحساب بعد. ابدأ من المزادات الحالية أو أنشئ مزاداً جديداً.'
          : 'No auctions linked to this account yet. Browse current auctions or create a new one.'}
      </p>
    </MarketplaceShell>
  );
}
