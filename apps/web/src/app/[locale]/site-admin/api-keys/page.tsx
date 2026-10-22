import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { OperationsWorkspaceClient } from '@/components/operations-workspace-client';
import { SiteAdminNav } from '@/components/site-admin/site-admin-nav';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تحكم الموقع · مفاتيح API',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminApiKeysPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const access = await requireSiteAdminPage(locale, null, { path: '/site-admin/api-keys' });
  return (
    <>
      <SiteAdminNav access={access} current="apiKeys" locale={locale} />
      <div className="site-admin--wide" style={{ margin: '0 auto', padding: '1rem' }}>
        {/* Session org context; page itself is site-console only. */}
        <OperationsWorkspaceClient portal="owner" section="api-keys" locale={locale} />
      </div>
    </>
  );
}
