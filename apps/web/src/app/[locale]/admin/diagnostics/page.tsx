import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { PlatformDiagnosticsPanel } from '@/components/platform/platform-diagnostics-panel';
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
  await requireSiteAdminPage(locale, null, { path: '/admin/diagnostics' });
  return (
    <div className="site-admin--wide">
        <PlatformDiagnosticsPanel locale={locale} />
      </div>
  );
}
