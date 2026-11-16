import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import '../../marketplace.css';
import '../../auctions-projects.css';
import { MarketplaceShell } from '@/components/marketplace/marketplace-shell';
import { ProjectsBrowse } from '@/components/projects/projects-browse';
import { Link } from '@/i18n/navigation';
import { DEVELOPMENT_PROJECTS } from '@/lib/development-projects-catalogue';
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
    title: ar ? 'مشاريع التطوير العقاري' : 'Development projects',
    description: ar
      ? 'مشاريع تطوير عقاري من بن حمود — وحدات قيد البيع ومراحل تنفيذ وخطط دفع.'
      : 'Bin Hamood development projects — units for sale, milestones and payment plans.',
    alternates: bilingualAlternates(locale, '/projects'),
  };
}

export default async function ProjectsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  setRequestLocale(locale);
  const { assertPublicSitePage } = await import('@/lib/site-page-gate');
  await assertPublicSitePage('projects');

  return (
    <MarketplaceShell
      locale={locale}
      kicker={ar ? 'مشاريع التطوير' : 'Development'}
      title={ar ? 'مشاريع التطوير العقاري' : 'Real estate development projects'}
      lead={
        ar
          ? 'تصفّح المشاريع حسب الحالة، طالع الوحدات وخطط الدفع ومراحل التنفيذ.'
          : 'Browse projects by status, units, payment plans and construction milestones.'
      }
      actions={
        <Link className="button button--gold button--small" href="/auctions">
          {ar ? 'المزادات العقارية' : 'Property auctions'}
        </Link>
      }
    >
      <ProjectsBrowse locale={locale} projects={DEVELOPMENT_PROJECTS} />
    </MarketplaceShell>
  );
}
