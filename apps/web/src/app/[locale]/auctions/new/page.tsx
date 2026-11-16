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
    <MarketplaceShell
      locale={locale}
      kicker={ar ? 'المزادات' : 'Auctions'}
      title={ar ? 'إنشاء مزاد عقاري' : 'Create a property auction'}
      lead={
        ar
          ? 'سجّل الدخول من مساحة المالك أو المطوّر لنشر مزاد رسمي. يمكنك الآن تصفح المزادات النشطة.'
          : 'Sign in from an owner or developer workspace to publish an official auction. You can browse live auctions now.'
      }
      actions={
        <>
          <a className="button button--gold button--small" href={signIn}>
            {ar ? 'تسجيل الدخول للمتابعة' : 'Sign in to continue'}
          </a>
          <Link className="button button--secondary button--small" href="/auctions">
            {ar ? 'المزادات الحالية' : 'Current auctions'}
          </Link>
        </>
      }
      band={
        <div className="mkt-band">
          <h2>{ar ? 'ما الذي ستحتاجه؟' : 'What you will need'}</h2>
          <p>
            {ar
              ? 'وصف العقار، السعر الابتدائي، مدة المزاد، ومستندات الملكية. بعد الاعتماد يظهر المزاد في القائمة العامة.'
              : 'Property description, starting price, auction window, and ownership documents. After approval it appears in the public list.'}
          </p>
        </div>
      }
    >
      <p className="ap-empty">
        {ar
          ? 'نموذج الإنشاء الكامل للمزاد سيُفعَّل داخل مساحة المالك قريباً — الروابط جاهزة من القائمة.'
          : 'The full create-auction form will open inside the owner workspace soon — nav links are ready.'}
      </p>
    </MarketplaceShell>
  );
}
