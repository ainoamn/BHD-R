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
    title: ar ? 'شركاء التطوير' : 'Development partners',
    alternates: bilingualAlternates(locale, '/projects/partners'),
  };
}

export default async function ProjectPartnersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  setRequestLocale(locale);
  const { assertPublicSitePage } = await import('@/lib/site-page-gate');
  await assertPublicSitePage('projects');

  return (
    <MarketplaceShell
      locale={locale}
      kicker={ar ? 'التطوير العقاري' : 'Development'}
      title={ar ? 'شركاء التطوير' : 'Development partners'}
      lead={
        ar
          ? 'مكاتب ومثمّنون وشركاء تأمين يعملون مع مشاريع بن حمود.'
          : 'Offices, appraisers and insurers working with Bin Hamood projects.'
      }
      actions={
        <>
          <Link className="button button--gold button--small" href="/offices">
            {ar ? 'المكاتب' : 'Offices'}
          </Link>
          <Link className="button button--secondary button--small" href="/appraisers">
            {ar ? 'المثمّنون' : 'Appraisers'}
          </Link>
          <Link className="button button--secondary button--small" href="/insurance">
            {ar ? 'التأمين' : 'Insurance'}
          </Link>
        </>
      }
    >
      <p className="ap-empty">
        {ar
          ? 'استعرض أدلة الشركاء من الروابط أعلاه، أو تواصل عبر بوابة الحساب للانضمام كشريك تطوير.'
          : 'Browse partner directories from the links above, or use the account portal to join as a development partner.'}
      </p>
    </MarketplaceShell>
  );
}