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
    title: ar ? 'التمويل العقاري' : 'Property financing',
    alternates: bilingualAlternates(locale, '/projects/financing'),
  };
}

export default async function ProjectFinancingPage({
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
      title={ar ? 'التمويل العقاري' : 'Property financing'}
      lead={
        ar
          ? 'خطط دفع داخل المشاريع، أو تثمين لدعم التمويل البنكي.'
          : 'In-project payment plans, or valuation support for bank financing.'
      }
      tabs={PROJECT_TABS('financing')}
      actions={
        <Link className="button button--primary button--small" href="/valuation">
          {ar ? 'طلب تثمين' : 'Request valuation'}
        </Link>
      }
    >
      <div className="ap-panel">
        <h2>{ar ? 'كيف نساعد؟' : 'How we help'}</h2>
        <ul className="ap-bid-list">
          <li>
            <span>{ar ? 'خطط دفع مرنة داخل المشروع' : 'Flexible in-project payment schedules'}</span>
            <strong>30/70</strong>
          </li>
          <li>
            <span>{ar ? 'تثمين لدعم البنوك' : 'Valuation support for banks'}</span>
            <strong>{ar ? 'تثمين' : 'Valuation'}</strong>
          </li>
          <li>
            <span>{ar ? 'ربط بشركاء التأمين' : 'Insurance partner referrals'}</span>
            <strong>{ar ? 'تأمين' : 'Insurance'}</strong>
          </li>
        </ul>
      </div>
    </SectionShell>
  );
}
