import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import '../../marketplace.css';
import { DirectoryBrowse } from '@/components/marketplace/directory-browse';
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
    title: ar ? 'المكاتب العقارية' : 'Real estate offices',
    description: ar
      ? 'دليل المكاتب العقارية في سلطنة عُمان: بيع، إيجار، وإدارة محافظ.'
      : 'Directory of real estate offices in Oman for sales, rentals and portfolio management.',
    alternates: bilingualAlternates(locale, '/offices'),
  };
}

export default async function OfficesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  setRequestLocale(locale);
  const { assertPublicSitePage } = await import('@/lib/site-page-gate');
  await assertPublicSitePage('offices');

  return (
    <MarketplaceShell
      locale={locale}
      kicker={ar ? 'دليل المكاتب' : 'Office directory'}
      title={ar ? 'كل المكاتب العقارية' : 'All real estate offices'}
      lead={
        ar
          ? 'تصفّح المكاتب المسجّلة حسب المدينة والتخصص، أو سجّل مكتبك ليظهر في الدليل.'
          : 'Browse listed offices by city and specialty, or register your office to appear in the directory.'
      }
      actions={
        <Link className="button button--gold button--small" href="/valuation">
          {ar ? 'اطلب تثمين عقار' : 'Request a valuation'}
        </Link>
      }
      band={
        <div className="mkt-band">
          <h2>{ar ? 'هل تملك مكتباً عقارياً؟' : 'Own a real estate office?'}</h2>
          <p>
            {ar
              ? 'انضم إلى دليل BHD R ليراك الباحثون عن بيع أو إيجار، واربط مكتبك لاحقاً بعقود وتحصيل المنصة.'
              : 'Join the BHD R directory so buyers and renters can find you, then connect your office to leases and collections.'}
          </p>
          <div className="mkt-band__actions">
            <a
              className="button button--gold button--small"
              href={`/api/auth/bhd/start?returnTo=${encodeURIComponent(`/${locale}/portal`)}`}
            >
              {ar ? 'سجّل كمكتب شريك' : 'Register as a partner office'}
            </a>
            <Link className="button button--glass button--small" href="/appraisers">
              {ar ? 'دليل المثمّنين' : 'Appraiser directory'}
            </Link>
          </div>
        </div>
      }
    >
      <DirectoryBrowse kind="office" locale={locale} joinHref={`/${locale}/portal`} />
    </MarketplaceShell>
  );
}
