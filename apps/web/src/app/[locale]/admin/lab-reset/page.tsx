import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LabResetDesk } from '@/components/lab-reset-desk';
import { SiteAdminNav } from '@/components/site-admin/site-admin-nav';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تحكم الموقع · إعادة ضبط التجارب',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminLabResetPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const access = await requireSiteAdminPage(locale, null, { path: '/admin/lab-reset' });
  return (
    <>
      <SiteAdminNav access={access} current="labReset" locale={locale} />
      <div className="site-admin--wide" style={{ margin: '0 auto', padding: '1rem' }}>
        <LabResetDesk locale={locale} />
      </div>
    </>
  );
}
