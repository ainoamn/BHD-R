import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import '../../../auctions-projects.css';
import {
  AUCTION_TABS,
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
    title: ar ? 'إنشاء مزاد' : 'Create auction',
    alternates: bilingualAlternates(locale, '/auctions/new'),
  };
}

export default async function CreateAuctionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  setRequestLocale(locale);
  const { assertPublicSitePage } = await import('@/lib/site-page-gate');
  await assertPublicSitePage('auctions');
  const signIn = `/api/auth/bhd/start?returnTo=${encodeURIComponent(`/${locale}/auctions/new`)}`;

  return (
    <SectionShell
      locale={locale}
      brand="BHD R"
      title={ar ? 'إنشاء مزاد' : 'Create auction'}
      lead={
        ar
          ? 'سجّل الدخول من مساحة المالك أو المطوّر لنشر مزاد رسمي.'
          : 'Sign in from an owner or developer workspace to publish an official auction.'
      }
      tabs={AUCTION_TABS('new')}
      actions={
        <>
          <a className="button button--primary button--small" href={signIn}>
            {ar ? 'تسجيل الدخول' : 'Sign in'}
          </a>
          <Link className="button button--secondary button--small" href="/auctions">
            {ar ? 'المزادات' : 'Auctions'}
          </Link>
        </>
      }
    >
      <div className="ap-panel">
        <h2>{ar ? 'ما الذي ستحتاجه؟' : 'What you will need'}</h2>
        <ul className="ap-bid-list">
          <li>
            <span>{ar ? 'وصف العقار والسعر الابتدائي' : 'Property description and starting price'}</span>
          </li>
          <li>
            <span>{ar ? 'مدة المزاد ومستندات الملكية' : 'Auction window and ownership documents'}</span>
          </li>
          <li>
            <span>{ar ? 'بعد الاعتماد يظهر في القائمة العامة' : 'After approval it appears publicly'}</span>
          </li>
        </ul>
      </div>
      <p className="ap-empty" style={{ marginTop: '1rem' }}>
        {ar
          ? 'نموذج الإنشاء الكامل سيُفعَّل داخل مساحة المالك قريباً.'
          : 'The full create form will open inside the owner workspace soon.'}
      </p>
    </SectionShell>
  );
}
