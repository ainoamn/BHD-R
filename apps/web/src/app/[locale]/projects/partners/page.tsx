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
    <SectionShell
      locale={locale}
      brand="BHD R"
      title={ar ? 'شركاء التطوير' : 'Development partners'}
      lead={
        ar
          ? 'مكاتب ومثمّنون وشركاء تأمين يعملون مع مشاريع بن حمود.'
          : 'Offices, appraisers and insurers working with Bin Hamood projects.'
      }
      tabs={PROJECT_TABS('partners')}
    >
      <div className="ap-simple-list">
        <Link href="/offices" prefetch>
          <h3>{ar ? 'المكاتب العقارية' : 'Real estate offices'}</h3>
          <p>{ar ? 'دليل المكاتب الشريكة' : 'Partner offices directory'}</p>
        </Link>
        <Link href="/appraisers" prefetch>
          <h3>{ar ? 'المثمّنون' : 'Appraisers'}</h3>
          <p>{ar ? 'تثمين معتمد للتمويل والبيع' : 'Certified valuation for financing and sales'}</p>
        </Link>
        <Link href="/insurance" prefetch>
          <h3>{ar ? 'التأمين' : 'Insurance'}</h3>
          <p>{ar ? 'شركاء تأمين عقاري' : 'Property insurance partners'}</p>
        </Link>
      </div>
    </SectionShell>
  );
}
