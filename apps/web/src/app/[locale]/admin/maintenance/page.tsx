import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تحكم الموقع · الصيانة',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminMaintenancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const access = await requireSiteAdminPage(locale, null, { path: '/admin/maintenance' });
  if (!access.root) redirect(`/${locale}/admin`);
  return null;
}
