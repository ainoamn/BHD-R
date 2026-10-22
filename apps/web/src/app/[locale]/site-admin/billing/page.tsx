import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { PlatformBillingPanel } from '@/components/platform/platform-billing-panel';
import { SiteAdminNav } from '@/components/site-admin/site-admin-nav';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تحكم الموقع · إحصائيات الاشتراك',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminBillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const access = await requireSiteAdminPage(locale, 'plans', { path: '/site-admin/billing' });
  return (
    <>
      <SiteAdminNav access={access} current="billing" locale={locale} />
      <div className="site-admin--wide" style={{ margin: '0 auto', padding: '1rem' }}>
        <PlatformBillingPanel locale={locale} />
      </div>
    </>
  );
}
