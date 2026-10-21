import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { PlatformAdminFrame } from '@/components/platform/platform-admin-frame';
import { PlansAdmin } from '@/components/site-admin/plans-admin';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'الاشتراكات · إدارة المنصة',
  robots: { index: false, follow: false },
};

/** Plans & organization subscriptions — same tooling as /site-admin/plans. */
export default async function PlatformSubscriptionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  await requireSiteAdminPage(locale, 'plans', { path: '/platform/subscriptions' });
  return (
    <PlatformAdminFrame locale={locale}>
      <PlansAdmin locale={locale} />
    </PlatformAdminFrame>
  );
}
