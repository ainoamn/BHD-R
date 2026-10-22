import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { SiteAdminNav } from '@/components/site-admin/site-admin-nav';
import { SiteAdminOverview } from '@/components/site-admin/site-admin-overview';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تحكم الموقع والنظام',
  robots: { index: false, follow: false, nocache: true },
};

/** Site owner / site manager console — never part of owner or tenant portals. */
export default async function SiteAdminHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const access = await requireSiteAdminPage(locale, null, { path: '/admin' });
  return (
    <>
      <SiteAdminNav access={access} current="overview" locale={locale} />
      <SiteAdminOverview locale={locale} />
    </>
  );
}
