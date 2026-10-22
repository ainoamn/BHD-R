import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { PlatformSecurityPanel } from '@/components/platform/platform-security-panel';
import { SiteAdminNav } from '@/components/site-admin/site-admin-nav';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تحكم الموقع · الأمن والتدقيق',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminSecurityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const access = await requireSiteAdminPage(locale, null, { path: '/site-admin/security' });
  return (
    <>
      <SiteAdminNav access={access} current="security" locale={locale} />
      <div className="site-admin--wide" style={{ margin: '0 auto', padding: '1rem' }}>
        <PlatformSecurityPanel locale={locale} />
      </div>
    </>
  );
}
