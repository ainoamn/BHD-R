import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { SiteAdminPanel } from '@/components/site-admin/site-admin-panel';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تحكم الموقع · شكاوى التأمين',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminComplaintsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const access = await requireSiteAdminPage(locale, 'complaints', {
    path: '/admin/complaints',
  });
  return (
    <SiteAdminPanel locale={locale} canEditInbox={access.root} />
  );
}
