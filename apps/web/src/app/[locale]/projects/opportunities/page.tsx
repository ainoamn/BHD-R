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
    title: ar ? 'الفرص الاستثمارية' : 'Investment opportunities',
    alternates: bilingualAlternates(locale, '/projects/opportunities'),
  };
}

export default async function ProjectOpportunitiesPage({
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
      title={ar ? 'الفرص الاستثمارية' : 'Investment opportunities'}
      lead={
        ar
          ? 'وحدات ومشاريع مختارة للبيع والاستثمار ضمن محفظة بن حمود.'
          : 'Selected units and projects for sale and investment in the Bin Hamood portfolio.'
      }
      actions={
        <Link className="button button--gold button--small" href="/projects">
          {ar ? 'عرض المشاريع' : 'View projects'}
        </Link>
      }
    >
      <div className="ap-grid">
        {[
          {
            ar: 'وحدات قيد البيع في مجمع الفرسان',
            en: 'Units for sale in Al Fursan complex',
            href: '/projects/prj-alfursan',
          },
          {
            ar: 'أبراج البحر — بنتهاوس وإطلالة',
            en: 'Al Bahr towers — penthouse & views',
            href: '/projects/prj-albahr',
          },
          {
            ar: 'فلل روضة التلال في نزوى',
            en: 'Al Rawda Hills villas in Nizwa',
            href: '/projects/prj-alrawda',
          },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="ap-card" prefetch>
            <div className="ap-card__body">
              <h3>{ar ? item.ar : item.en}</h3>
              <p className="ap-card__meta">
                {ar ? 'فرصة استثمارية من كتالوج المشاريع' : 'Investment opportunity from the projects catalogue'}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </MarketplaceShell>
  );
}
