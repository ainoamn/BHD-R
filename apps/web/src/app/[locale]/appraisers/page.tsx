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
    title: ar ? 'المثمّنون العقاريون' : 'Property appraisers',
    description: ar
      ? 'دليل المثمّنين العقاريين في عُمان للتمويل والبيع والمنازعات.'
      : 'Directory of property appraisers in Oman for finance, sale and disputes.',
    alternates: bilingualAlternates(locale, '/appraisers'),
  };
}

export default async function AppraisersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  setRequestLocale(locale);
  const { assertPublicSitePage } = await import('@/lib/site-page-gate');
  await assertPublicSitePage('appraisers');

  return (
    <MarketplaceShell
      locale={locale}
      kicker={ar ? 'دليل التثمين' : 'Appraiser directory'}
      title={ar ? 'كل المثمّنين العقاريين' : 'All property appraisers'}
      lead={
        ar
          ? 'اعثر على مثمّن في مدينتك، أو أرسل طلب تثمين ونربطك بالأنسب.'
          : 'Find an appraiser in your city, or send a valuation request and we match the right one.'
      }
      actions={
        <Link className="button button--gold button--small" href="/valuation">
          {ar ? 'اطلب تثمين الآن' : 'Request valuation now'}
        </Link>
      }
      band={
        <div className="mkt-band">
          <h2>{ar ? 'مثمّن عقاري؟' : 'Are you an appraiser?'}</h2>
          <p>
            {ar
              ? 'أظهر مكتبك في الدليل واستقبل طلبات تثمين من أصحاب العقارات عبر المنصة.'
              : 'List your practice in the directory and receive valuation requests from property owners.'}
          </p>
          <div className="mkt-band__actions">
            <a
              className="button button--gold button--small"
              href={`/api/auth/bhd/start?returnTo=${encodeURIComponent(`/${locale}/portal`)}`}
            >
              {ar ? 'انضم كمثمّن' : 'Join as an appraiser'}
            </a>
            <Link className="button button--glass button--small" href="/valuation">
              {ar ? 'نموذج طلب التثمين' : 'Valuation request form'}
            </Link>
          </div>
        </div>
      }
    >
      <DirectoryBrowse kind="appraiser" locale={locale} joinHref={`/${locale}/portal`} />
    </MarketplaceShell>
  );
}
