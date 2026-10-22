import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تحكم الموقع · قوالب الإشعارات',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminNotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  await requireSiteAdminPage(locale, null, { path: '/admin/notifications' });
  return null;
}
