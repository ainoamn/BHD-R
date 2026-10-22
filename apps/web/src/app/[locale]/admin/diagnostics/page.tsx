import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { PlatformDiagnosticsPanel } from '@/components/platform/platform-diagnostics-panel';
import { SiteAdminNav } from '@/components/site-admin/site-admin-nav';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تحكم الموقع · تشخيص النظام',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminDiagnosticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const access = await requireSiteAdminPage(locale, null, { path: '/admin/diagnostics' });
  return (
    <>
      <SiteAdminNav access={access} current="diagnostics" locale={locale} />
      <div className="site-admin--wide" style={{ margin: '0 auto', padding: '1rem' }}>
        <PlatformDiagnosticsPanel locale={locale} />
      </div>
    </>
  );
}
