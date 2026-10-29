import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { SiteAdminChrome } from '@/components/site-admin/site-admin-chrome';
import { privatePortalRobots } from '@/lib/seo';
import { requireSiteAdminPage } from '@/lib/site-admin-page';
import '../../site-admin.css';
import '../../portal-adaptive.css';
import '../../badges-verification.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: privatePortalRobots,
  title: {
    default: 'تحكم الموقع والنظام',
    template: '%s · تحكم الموقع',
  },
};

/**
 * Dedicated chrome for site owners / managers only.
 * Sidebar lives here so every console page shares one navigation.
 */
export default async function SiteAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const access = await requireSiteAdminPage(locale, null, { path: '/admin' });
  return (
    <div className="site-admin-shell">
      <SiteAdminChrome access={access} locale={locale}>
        {children}
      </SiteAdminChrome>
    </div>
  );
}
