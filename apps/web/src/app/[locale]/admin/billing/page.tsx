import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { PlatformBillingPanel } from '@/components/platform/platform-billing-panel';
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
  await requireSiteAdminPage(locale, 'plans', { path: '/admin/billing' });
  return (
    <div className="site-admin--wide">
        <PlatformBillingPanel locale={locale} />
      </div>
  );
}
