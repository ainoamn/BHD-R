import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import '../../auctions-projects.css';
import {
  PROJECT_TABS,
  SectionShell,
} from '@/components/marketplace/section-shell';
import { ProjectsBrowse } from '@/components/projects/projects-browse';
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
    title: ar ? 'التطوير العقاري' : 'Real estate development',
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
    <SectionShell
      locale={locale}
      brand="BHD R"
      title={ar ? 'التطوير العقاري' : 'Real estate development'}
      lead={
        ar
          ? 'مشاريع مرتّبة حسب الحالة — وحدات وخطط دفع ومراحل تنفيذ.'
          : 'Projects ordered by status — units, payment plans and milestones.'
      }
      tabs={PROJECT_TABS('projects')}
    >
      <ProjectsBrowse locale={locale} projects={DEVELOPMENT_PROJECTS} />
    </SectionShell>
  );
}
