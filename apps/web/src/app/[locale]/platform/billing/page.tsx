import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { PlatformAdminFrame } from '@/components/platform/platform-admin-frame';
import { PlatformBillingPanel } from '@/components/platform/platform-billing-panel';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'إحصائيات الاشتراك · إدارة المنصة',
  robots: { index: false, follow: false },
};

export default async function PlatformBillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  await requireSiteAdminPage(locale, 'plans', { path: '/platform/billing' });
  return (
    <PlatformAdminFrame locale={locale}>
      <PlatformBillingPanel locale={locale} />
    </PlatformAdminFrame>
  );
}
