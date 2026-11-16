import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import '../../../auctions-projects.css';
import {
  PROJECT_TABS,
  SectionShell,
} from '@/components/marketplace/section-shell';
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

  const items = [
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
  ];

  return (
    <SectionShell
      locale={locale}
      brand="BHD R"
      title={ar ? 'الفرص الاستثمارية' : 'Investment opportunities'}
      lead={
        ar
          ? 'وحدات ومشاريع مختارة للبيع والاستثمار.'
          : 'Selected units and projects for sale and investment.'
      }
      tabs={PROJECT_TABS('opportunities')}
    >
      <div className="ap-simple-list">
        {items.map((item) => (
          <Link key={item.href} href={item.href} prefetch>
            <h3>{ar ? item.ar : item.en}</h3>
            <p>{ar ? 'من كتالوج المشاريع' : 'From the projects catalogue'}</p>
          </Link>
        ))}
      </div>
    </SectionShell>
  );
}
