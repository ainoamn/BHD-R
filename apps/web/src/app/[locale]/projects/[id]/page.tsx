import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import '../../../auctions-projects.css';
import {
  PROJECT_TABS,
  SectionShell,
} from '@/components/marketplace/section-shell';
import { ProjectDetailView } from '@/components/projects/project-detail-view';
import { getDevelopmentProject } from '@/lib/development-projects-catalogue';
import { bilingualAlternates } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const ar = locale !== 'en';
  const project = getDevelopmentProject(id);
  if (!project) return { title: ar ? 'مشروع' : 'Project' };
  return {
    title: ar ? project.titleAr : project.titleEn,
    description: ar ? project.descriptionAr : project.descriptionEn,
    alternates: bilingualAlternates(locale, `/projects/${id}`),
  };
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: raw, id } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  setRequestLocale(locale);
  const { assertPublicSitePage } = await import('@/lib/site-page-gate');
  await assertPublicSitePage('projects');

  const project = getDevelopmentProject(id);
  if (!project) notFound();

  return (
    <SectionShell
      locale={locale}
      brand="BHD R"
      title={ar ? project.titleAr : project.titleEn}
      lead={ar ? project.cityAr : project.cityEn}
      tabs={PROJECT_TABS('projects')}
    >
      <ProjectDetailView locale={locale} project={project} />
    </SectionShell>
  );
}
